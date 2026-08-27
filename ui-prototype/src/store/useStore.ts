// Central in-memory store — replaces the STORE global object + mutator functions
// scattered across each MODULE block in the HTML prototype. No persistence:
// a page refresh resets to seed data, matching the original by design.

import { create } from "zustand";
import { computeSale } from "@/lib/calculations";
import { nowKE, uid } from "@/lib/format";
import { buildSeed } from "@/lib/seed";
import type { Customer, Lot, LotState, Payment, PaymentRail, Supplier, TradeEvent } from "@/types";

interface StoreState {
	suppliers: Supplier[];
	customers: Customer[];
	lots: Lot[];
	payments: Payment[];
	events: TradeEvent[];
	seq: { ticket: number; lot: number; invoice: number; payment: number };

	// -- lookups --
	findLot: (id: string) => Lot | undefined;
	findSupplier: (id: string | null | undefined) => Supplier | undefined;
	findCustomer: (id: string | null | undefined) => Customer | undefined;

	// -- suppliers --
	createSupplier: (data: Omit<Supplier, "id" | "status" | "createdBy" | "approvedBy">) => Supplier;
	updateSupplier: (id: string, data: Partial<Supplier>) => void;
	submitSupplierForVerification: (id: string) => { ok: boolean; message?: string };
	approveSupplier: (id: string) => void;

	// -- customers --
	createCustomer: (data: Omit<Customer, "id" | "status" | "createdBy" | "approvedBy">) => Customer;
	updateCustomer: (id: string, data: Partial<Customer>) => void;
	submitCustomerForVerification: (id: string) => void;
	approveCustomer: (id: string) => void;

	// -- trade lifecycle --
	createTicket: (input: { supplierId: string; item: string; qty: number }) => Lot;
	submitIntake: (
		lotId: string,
		input: {
			grossKg: number;
			tareKg: number;
			bags: number;
			wbNumber: string;
			transporterId: string | null;
			vehicleReg: string;
			moisturePct: number;
			fmPct: number;
			aflatoxinPpb: number;
			county: string;
			area: string;
			reasonCode: string;
		},
	) => void;
	postDeductions: (lotId: string) => void;
	capitaliseTransport: (lotId: string, input: { haulage: number; cess: number; offloading: number }) => void;
	payTransporter: (lotId: string, input: { rail: PaymentRail }) => void;
	submitSale: (lotId: string, input: { customerId: string; sellRatePerKg: number }) => void;
	settlePayment: (lotId: string, input: { rail: PaymentRail }) => void;

	logEvent: (lotId: string, action: string, detail?: string) => void;
}

export const useStore = create<StoreState>((set, get) => {
	const seed = buildSeed();

	return {
		...seed,

		findLot: (id) => get().lots.find((l) => l.id === id),
		findSupplier: (id) => (id ? get().suppliers.find((s) => s.id === id) : undefined),
		findCustomer: (id) => (id ? get().customers.find((c) => c.id === id) : undefined),

		logEvent: (lotId, action, detail) => {
			set((state) => ({
				events: [...state.events, { id: uid("EVT"), lotId, action, detail, who: "You (Purchase User)", at: nowKE() }],
			}));
		},

		createSupplier: (data) => {
			const supplier: Supplier = {
				...data,
				id: uid("SUP"),
				status: "Draft",
				createdBy: "You (Purchase User)",
				approvedBy: "",
			};
			set((state) => ({ suppliers: [...state.suppliers, supplier] }));
			return supplier;
		},

		updateSupplier: (id, data) => {
			set((state) => ({
				suppliers: state.suppliers.map((s) => (s.id === id ? { ...s, ...data } : s)),
			}));
		},

		submitSupplierForVerification: (id) => {
			const supplier = get().suppliers.find((s) => s.id === id);
			if (!supplier) return { ok: false, message: "Supplier not found" };
			if (!supplier.kraPin) return { ok: false, message: "KRA PIN required before verification" };
			const dup = get().suppliers.find((x) => x.id !== id && x.kraPin === supplier.kraPin);
			if (dup) return { ok: false, message: "Blocked: another supplier already uses this KRA PIN" };
			get().updateSupplier(id, { status: "Verified" });
			return { ok: true };
		},

		approveSupplier: (id) => {
			get().updateSupplier(id, { status: "Approved", approvedBy: "Finance (you)" });
		},

		createCustomer: (data) => {
			const customer: Customer = {
				...data,
				id: uid("CUS"),
				status: "Draft",
				createdBy: "You (Sales User)",
				approvedBy: "",
			};
			set((state) => ({ customers: [...state.customers, customer] }));
			return customer;
		},

		updateCustomer: (id, data) => {
			set((state) => ({
				customers: state.customers.map((c) => (c.id === id ? { ...c, ...data } : c)),
			}));
		},

		submitCustomerForVerification: (id) => {
			get().updateCustomer(id, { status: "Verified" });
		},

		approveCustomer: (id) => {
			get().updateCustomer(id, { status: "Approved", approvedBy: "Finance (you)" });
		},

		createTicket: ({ supplierId, item, qty }) => {
			const seq = get().seq;
			const ticketNo = "TCK-" + seq.ticket;
			const lot: Lot = {
				id: uid("LOT"),
				ticketNo,
				item,
				state: "TICKET" as LotState,
				supplierId,
				customerId: null,
				itemQty: qty,
				createdAt: nowKE(),
				reasonCodes: [],
			};
			set((state) => ({ lots: [...state.lots, lot], seq: { ...state.seq, ticket: state.seq.ticket + 1 } }));
			const supplier = get().findSupplier(supplierId);
			get().logEvent(lot.id, "Ticket created", `${qty} kg ${item} expected from ${supplier?.name ?? supplierId}`);
			return lot;
		},

		submitIntake: (lotId, input) => {
			set((state) => ({
				lots: state.lots.map((l) =>
					l.id === lotId
						? {
								...l,
								grossKg: input.grossKg,
								tareKg: input.tareKg,
								bags: input.bags,
								wbNumber: input.wbNumber,
								transporterId: input.transporterId,
								vehicleReg: input.vehicleReg,
								moisturePct: input.moisturePct,
								fmPct: input.fmPct,
								aflatoxinPpb: input.aflatoxinPpb,
								aflatoxinTested: true,
								county: input.county,
								area: input.area,
								state: "INTAKE" as LotState,
							}
						: l,
				),
			}));
			const netKg = input.grossKg - input.tareKg;
			get().logEvent(
				lotId,
				"Intake recorded",
				`${netKg} kg net, moisture ${input.moisturePct}%, FM ${input.fmPct}%, aflatoxin ${input.aflatoxinPpb}ppb`,
			);
		},

		postDeductions: (lotId) => {
			const lot = get().findLot(lotId);
			if (!lot) return;
			set((state) => ({
				lots: state.lots.map((l) => (l.id === lotId ? { ...l, state: "LOT" as LotState } : l)),
			}));
			const supplier = get().findSupplier(lot.supplierId);
			get().logEvent(lotId, "Lot created, net invoice posted", `Invoiced to ${supplier?.name ?? lot.supplierId}`);
		},

		capitaliseTransport: (lotId, input) => {
			set((state) => ({
				lots: state.lots.map((l) =>
					l.id === lotId
						? { ...l, haulage: input.haulage, cess: input.cess, offloading: input.offloading, state: "POSITION" as LotState, transportPaid: false }
						: l,
				),
			}));
			get().logEvent(
				lotId,
				"Transport capitalised, moved to Position",
				`Haulage KES ${input.haulage}, cess KES ${input.cess}, offloading KES ${input.offloading}`,
			);
		},

		payTransporter: (lotId, input) => {
			const lot = get().findLot(lotId);
			if (!lot || !lot.transporterId) return;
			const amount = (lot.haulage ?? 0) + (lot.cess ?? 0);
			const seq = get().seq;
			const paymentId = "PAY-" + seq.payment;
			const payment: Payment = {
				id: paymentId, partyType: "Supplier", partyId: lot.transporterId, lotId,
				amount, rail: input.rail, status: "Completed", daysAgo: 0,
			};
			set((state) => ({
				payments: [...state.payments, payment],
				lots: state.lots.map((l) => (l.id === lotId ? { ...l, transportPaid: true } : l)),
				seq: { ...state.seq, payment: state.seq.payment + 1 },
			}));
			const transporter = get().findSupplier(lot.transporterId);
			get().logEvent(lotId, "Transporter paid", `KES ${amount} (haulage + cess) via ${input.rail} to ${transporter?.name ?? lot.transporterId}`);
		},

		submitSale: (lotId, input) => {
			const seq = get().seq;
			const invoiceNo = "INV-" + seq.invoice;
			const etimsControlNo = "KRA-CU-" + Math.floor(100000 + Math.random() * 899999);
			set((state) => ({
				lots: state.lots.map((l) =>
					l.id === lotId
						? {
								...l,
								customerId: input.customerId,
								sellRatePerKg: input.sellRatePerKg,
								state: "INVOICED" as LotState,
								invoiceNo,
								etimsControlNo,
							}
						: l,
				),
				seq: { ...state.seq, invoice: state.seq.invoice + 1 },
			}));
			const customer = get().findCustomer(input.customerId);
			get().logEvent(lotId, "Sales invoice posted, eTIMS transmitted", `${invoiceNo} to ${customer?.name ?? input.customerId}, control unit ${etimsControlNo}`);
		},

		settlePayment: (lotId, input) => {
			const lot = get().findLot(lotId);
			if (!lot) return;
			const sale = computeSale(lot);
			if (!sale) return;
			const seq = get().seq;
			const paymentId = "PAY-" + seq.payment;
			const payment: Payment = {
				id: paymentId,
				partyType: "Customer",
				partyId: lot.customerId as string,
				lotId,
				amount: sale.revenue,
				rail: input.rail,
				status: "Completed",
				daysAgo: 0,
			};
			set((state) => ({
				payments: [...state.payments, payment],
				lots: state.lots.map((l) => (l.id === lotId ? { ...l, state: "SETTLED" as LotState } : l)),
				seq: { ...state.seq, payment: state.seq.payment + 1 },
			}));
			const customer = get().findCustomer(lot.customerId);
			get().logEvent(
				lotId,
				"Payment received, lot settled",
				`KES ${Math.round(sale.revenue)} via ${input.rail} from ${customer?.name ?? lot.customerId}. Margin per tonne: KES ${Math.round(sale.marginPerTonne)}`,
			);
		},
	};
});
