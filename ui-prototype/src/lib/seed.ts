// Seed data ported verbatim from ui-prototype/reference/holec-erp-prototype.html `seed()`.

import { computePayable } from "@/lib/calculations";
import { daysAgoKE, nowKE, uid } from "@/lib/format";
import type { Customer, Lot, LotState, Payment, Sequences, Supplier, TradeEvent } from "@/types";

export const seedSuppliers: Supplier[] = [
	{
		id: "SUP-0001", name: "Wanjiru Grain Traders", group: "Aggregator", kraPin: "A011223344B", idNo: "22334455",
		county: "Nakuru", address: "Njoro Rd, Nakuru", etims: "Registered", vat: "Registered", aflatoxinLicence: true,
		bank: "Equity Bank — 0110xxxxxx", bankLetter: true, callbackDone: true, rail: "PesaLink",
		transferBorneBy: "Supplier", status: "Approved", createdBy: "Grace (Ops)", approvedBy: "Finance",
	},
	{
		id: "SUP-0002", name: "Kiptoo Farmers Cooperative", group: "Farmer", kraPin: "A022334455C", idNo: "11223366",
		county: "Uasin Gishu", address: "Eldoret-Ziwa Rd", etims: "Buyer-Generated", vat: "Not registered", aflatoxinLicence: false,
		bank: "KCB — 0220xxxxxx", bankLetter: true, callbackDone: true, rail: "Mpesa",
		transferBorneBy: "Us", status: "Approved", createdBy: "Grace (Ops)", approvedBy: "Finance",
	},
	{
		id: "SUP-0003", name: "Rift Valley Logistics (Transport)", group: "Transporter", kraPin: "A033445566D", idNo: "33445566",
		county: "Nakuru", address: "Industrial Area, Nakuru", etims: "Registered", vat: "Registered", aflatoxinLicence: false,
		bank: "I&M Bank — 0330xxxxxx", bankLetter: true, callbackDone: true, rail: "Bank Transfer",
		transferBorneBy: "Us", status: "Approved", createdBy: "Grace (Ops)", approvedBy: "Finance",
	},
	{
		id: "SUP-0004", name: "Cherono Bulk Suppliers", group: "Trader", kraPin: "A044556677E", idNo: "44556677",
		county: "Trans Nzoia", address: "Kitale Town", etims: "Registered", vat: "Registered", aflatoxinLicence: true,
		bank: "", bankLetter: false, callbackDone: false, rail: "PesaLink",
		transferBorneBy: "Supplier", status: "Verified", createdBy: "Grace (Ops)", approvedBy: "",
	},
	{
		id: "SUP-0005", name: "Chebet & Sons", group: "Farmer", kraPin: "", idNo: "",
		county: "Nakuru", address: "", etims: "", vat: "", aflatoxinLicence: false,
		bank: "", bankLetter: false, callbackDone: false, rail: "",
		transferBorneBy: "", status: "Draft", createdBy: "Grace (Ops)", approvedBy: "",
	},
];

export const seedCustomers: Customer[] = [
	{
		id: "CUS-0001", name: "Pembe Flour Mills Ltd", group: "Miller", kraPin: "P051667788F",
		address: "Athi River, Machakos", creditLimit: 8000000, creditTerms: "Net 14", exposureLimit: 12000000,
		guarantee: "Bank guarantee — KES 5,000,000", moistureRule: "13.5% max", fmRule: "2.0% max",
		offloadingBorneBy: "Customer", status: "Approved", createdBy: "Sales User", approvedBy: "Finance",
	},
	{
		id: "CUS-0002", name: "Unga Group Kenya", group: "Miller", kraPin: "P062778899G",
		address: "Industrial Area, Nairobi", creditLimit: 5000000, creditTerms: "Net 7", exposureLimit: 6000000,
		guarantee: "Trade reference on file", moistureRule: "13.0% max", fmRule: "1.5% max",
		offloadingBorneBy: "Us", status: "Approved", createdBy: "Sales User", approvedBy: "Finance",
	},
	{
		id: "CUS-0003", name: "Mombasa Grain Exports", group: "Exporter", kraPin: "",
		address: "Mombasa", creditLimit: 0, creditTerms: "", exposureLimit: 0,
		guarantee: "", moistureRule: "", fmRule: "", offloadingBorneBy: "",
		status: "Draft", createdBy: "Sales User", approvedBy: "",
	},
];

interface MakeLotOpts {
	ticketNo: string;
	supplierId: string;
	state: LotState;
	grossKg: number;
	tareKg: number;
	bags: number;
	moisturePct: number;
	fmPct: number;
	aflatoxinPpb: number;
	aflatoxinTested: boolean;
	county: string;
	area: string;
	transporterId?: string | null;
	vehicleReg: string;
	haulage?: number;
	cess?: number;
	offloading?: number;
	customerId?: string;
	sellRatePerKg?: number;
	daysAgo?: number;
}

function makeLot(opts: MakeLotOpts): Lot {
	return {
		id: uid("LOT"),
		ticketNo: opts.ticketNo,
		item: "Maize",
		state: opts.state,
		supplierId: opts.supplierId,
		customerId: opts.customerId ?? null,
		grossKg: opts.grossKg,
		tareKg: opts.tareKg,
		bags: opts.bags,
		moisturePct: opts.moisturePct,
		fmPct: opts.fmPct,
		aflatoxinPpb: opts.aflatoxinPpb,
		aflatoxinTested: opts.aflatoxinTested,
		county: opts.county,
		area: opts.area,
		transporterId: opts.transporterId,
		vehicleReg: opts.vehicleReg,
		haulage: opts.haulage || 0,
		cess: opts.cess || 0,
		offloading: opts.offloading || 0,
		sellRatePerKg: opts.sellRatePerKg || null,
		createdAt: daysAgoKE(opts.daysAgo || 0),
		reasonCodes: [],
		transportPaid: opts.state === "SETTLED",
	};
}

export interface SeedResult {
	suppliers: Supplier[];
	customers: Customer[];
	lots: Lot[];
	payments: Payment[];
	events: TradeEvent[];
	seq: Sequences;
}

export function buildSeed(): SeedResult {
	// NOTE: seeded tickets already occupy TCK-1001..TCK-1006 (see below), so the
	// next-ticket sequence must start past that range. The HTML prototype's
	// reference seed left this at 1004, which collides with the seeded
	// TCK-1004 the moment a new ticket is created — fixed here.
	const seq: Sequences = { ticket: 1007, lot: 2031, invoice: 5501, payment: 7201 };
	const events: TradeEvent[] = [];

	function logEvent(lotId: string, action: string, detail?: string) {
		events.push({ id: uid("EVT"), lotId, action, detail, who: "You (Purchase User)", at: nowKE() });
	}

	const lots: Lot[] = [];

	lots.push(
		makeLot({
			ticketNo: "TCK-1001", supplierId: "SUP-0001", state: "SETTLED",
			grossKg: 9200, tareKg: 200, bags: 100, moisturePct: 14.8, fmPct: 1.1, aflatoxinPpb: 3, aflatoxinTested: true,
			county: "Nakuru", area: "Njoro", transporterId: "SUP-0003", vehicleReg: "KDA 221C",
			haulage: 18000, cess: 4500, offloading: 3000, customerId: "CUS-0001", sellRatePerKg: 52, daysAgo: 9,
		}),
	);
	lots.push(
		makeLot({
			ticketNo: "TCK-1002", supplierId: "SUP-0002", state: "INVOICED",
			grossKg: 5400, tareKg: 120, bags: 60, moisturePct: 13.2, fmPct: 0.8, aflatoxinPpb: 2, aflatoxinTested: true,
			county: "Uasin Gishu", area: "Ziwa", transporterId: "SUP-0003", vehicleReg: "KDB 552F",
			haulage: 11000, cess: 2700, offloading: 1800, customerId: "CUS-0002", sellRatePerKg: 51, daysAgo: 5,
		}),
	);
	lots.push(
		makeLot({
			ticketNo: "TCK-1003", supplierId: "SUP-0001", state: "POSITION",
			grossKg: 12000, tareKg: 240, bags: 130, moisturePct: 21.4, fmPct: 1.6, aflatoxinPpb: 4, aflatoxinTested: true,
			county: "Nakuru", area: "Njoro", transporterId: "SUP-0003", vehicleReg: "KDA 221C",
			haulage: 24000, cess: 6000, offloading: 0, daysAgo: 3,
		}),
	);
	lots.push(
		makeLot({
			ticketNo: "TCK-1004", supplierId: "SUP-0002", state: "LOT",
			grossKg: 6800, tareKg: 150, bags: 75, moisturePct: 13.9, fmPct: 0.9, aflatoxinPpb: 1, aflatoxinTested: true,
			county: "Uasin Gishu", area: "Ziwa", transporterId: null, vehicleReg: "", daysAgo: 1,
		}),
	);
	lots.push(
		makeLot({
			ticketNo: "TCK-1005", supplierId: "SUP-0001", state: "INTAKE",
			grossKg: 8100, tareKg: 190, bags: 90, moisturePct: 16.0, fmPct: 1.3, aflatoxinPpb: 2, aflatoxinTested: true,
			county: "Nakuru", area: "Njoro", transporterId: null, vehicleReg: "", daysAgo: 0,
		}),
	);
	lots.push({
		id: uid("LOT"),
		ticketNo: "TCK-1006",
		item: "Maize",
		state: "TICKET",
		supplierId: "SUP-0004",
		customerId: null,
		itemQty: 7000,
		createdAt: nowKE(),
		reasonCodes: [],
	});

	lots.forEach((l) => {
		if (l.state !== "TICKET") logEvent(l.id, "Lot lifecycle seeded to " + l.state, "Initial demo data");
		if (l.state === "INVOICED" || l.state === "SETTLED") {
			l.invoiceNo = "INV-" + seq.invoice++;
			l.etimsControlNo = "KRA-CU-" + Math.floor(100000 + Math.random() * 899999);
		}
	});

	const payments: Payment[] = [
		{
			id: "PAY-7101", partyType: "Supplier", partyId: "SUP-0001", lotId: lots[0].id,
			amount: computePayable(lots[0]).netPayable, rail: "PesaLink", status: "Completed", daysAgo: 8,
		},
		{
			id: "PAY-7102", partyType: "Supplier", partyId: "SUP-0002", lotId: lots[1].id,
			amount: computePayable(lots[1]).netPayable, rail: "Mpesa", status: "Completed", daysAgo: 4,
		},
	];

	return { suppliers: seedSuppliers, customers: seedCustomers, lots, payments, events, seq };
}
