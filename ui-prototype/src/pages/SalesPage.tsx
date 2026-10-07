import { ShoppingCart, Upload, AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/EmptyState";
import { FieldWrapper } from "@/components/shared/FieldWrapper";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveLot } from "@/hooks/useActiveLot";
import { computeLandedCost, computePayable } from "@/lib/calculations";
import { fmtKES } from "@/lib/format";
import { useStore } from "@/store/useStore";

export default function SalesPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const lots = useStore((s) => s.lots);
	const customers = useStore((s) => s.customers);
	const findSupplier = useStore((s) => s.findSupplier);
	const submitSale = useStore((s) => s.submitSale);
	const seq = useStore((s) => s.seq);

	const positionLots = useMemo(() => lots.filter((l) => l.state === "POSITION"), [lots]);
	const targetId = id ?? positionLots[0]?.id;
	const lot = targetId ? lots.find((l) => l.id === targetId) : undefined;

	useActiveLot(lot?.id);

	const [customerId, setCustomerId] = useState("");
	const [sellRate, setSellRate] = useState("");
	const [deliveryGross, setDeliveryGross] = useState<string>("1000");
	const [deliveryTare, setDeliveryTare] = useState<string>("590");
	const [errors, setErrors] = useState<Record<string, string>>({});

	if (!targetId) {
		return (
			<div>
				<PageHeader title="Sale & Invoicing" />
				<EmptyState icon={ShoppingCart} title="No lots currently held in Position" />
			</div>
		);
	}

	if (!lot || lot.state !== "POSITION") {
		return (
			<div>
				<PageHeader title="Sale & Invoicing" />
				<EmptyState title="That lot has moved on" description={positionLots.length ? "Pick another lot below." : "No lots currently waiting."} />
				{positionLots.length > 0 && (
					<div className="mt-3 flex flex-wrap gap-2">
						{positionLots.map((t) => (
							<Button key={t.id} variant="outline" size="sm" onClick={() => navigate(`/sales/${t.id}`)}>{t.ticketNo}</Button>
						))}
					</div>
				)}
			</div>
		);
	}

	const sup = findSupplier(lot.supplierId);
	const payable = computePayable(lot);
	const landed = computeLandedCost(lot);
	const approvedCustomers = customers.filter((c) => c.status === "Approved");

	// Delivery Weighbridge Calculations
	const grossNum = Number(deliveryGross) || 0;
	const tareNum = Number(deliveryTare) || 0;
	const calculatedNetDelivered = Math.max(0, grossNum - tareNum);

	// Loss Reconciliation
	const expectedKg = payable.acceptedNetKg || (lot.grossKg ? lot.grossKg - (lot.tareKg || 0) : 520);
	const deliveredKg = calculatedNetDelivered;
	const lossKg = Math.max(0, expectedKg - deliveredKg);
	const tolerance = 80;
	const recoverableKg = Math.max(0, lossKg - tolerance);
	const transporterRecoveryKES = recoverableKg * (landed.perKg || 48);

	// Financial Calculations (Landed cost does NOT change with sell rate!)
	const rateNum = Number(sellRate) || 0;
	const revenue = calculatedNetDelivered * rateNum;
	const landedCostTotal = landed.totalCost;
	const landedRatePerKg = landed.perKg || 48;
	const margin = revenue - landedCostTotal;

	function handleUploadSlip() {
		toast.info("Uploading customer delivery slip...", { duration: 1500 });
		setTimeout(() => {
			setDeliveryGross("1000");
			setDeliveryTare("590");
			toast.success("Delivery slip read successfully! Gross: 1,000 kg, Tare: 590 kg.");
		}, 800);
	}

	function handleSubmit() {
		const next: Record<string, string> = {};
		if (!customerId) next.customerId = "Select a customer";
		if (!rateNum) next.sellRate = "Enter a sell rate";
		setErrors(next);
		if (Object.keys(next).length > 0) {
			toast.error(Object.values(next)[0]);
			return;
		}
		if (!lot) return;

		submitSale(lot.id, { customerId, sellRatePerKg: rateNum });
		const customer = customers.find((c) => c.id === customerId);
		toast.success(`Invoiced to ${customer?.name ?? ""} — eTIMS confirmed`);
		toast.info("Payment drafts initiated for Transporter, CESS, and Casual Labour for payment approval.");
		navigate(`/lots/${lot.id}`);
	}

	return (
		<div>
			<div className="mb-4">
				<h1 className="text-xl font-semibold tracking-tight">Sale & Invoicing</h1>
				<p className="text-sm text-muted-foreground">{lot.ticketNo} · {sup?.name ?? "Supplier"} · Margin: <span className="font-semibold text-slate-900">{fmtKES(margin)}</span></p>
			</div>

			{positionLots.length > 0 && (
				<div className="mb-4 flex flex-wrap items-center gap-1.5">
					<span className="text-xs text-muted-foreground">{positionLots.length} lots ready:</span>
					{positionLots.map((t) => (
						<Button key={t.id} size="sm" variant={t.id === lot.id ? "default" : "outline"} onClick={() => navigate(`/sales/${t.id}`)}>
							{t.ticketNo}
						</Button>
					))}
				</div>
			)}

			{/* Top 2-Column Grid: Customer Weighbridge Slip & Loss Reconciliation */}
			<div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Left Box: Customer Weighbridge Slip */}
				<SectionCard title="Customer Weighbridge Slip">
					<div className="space-y-4">
						<div>
							<span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">WEIGHBRIDGE SLIP (DELIVERY)</span>
							<Button variant="outline" size="sm" onClick={handleUploadSlip} className="gap-2">
								<Upload className="h-4 w-4" />
								Upload Delivery Slip
							</Button>
						</div>

						<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
							<FieldWrapper label="GROSS (KG) *" required>
								<Input type="number" value={deliveryGross} onChange={(e) => setDeliveryGross(e.target.value)} className="h-9 font-mono text-sm" />
							</FieldWrapper>

							<FieldWrapper label="TARE (KG) *" required>
								<Input type="number" value={deliveryTare} onChange={(e) => setDeliveryTare(e.target.value)} className="h-9 font-mono text-sm" />
							</FieldWrapper>

							<div>
								<span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">CALCULATED NET DELIVERED</span>
								<div className="flex h-9 items-center rounded-md border bg-slate-100/80 px-3 font-mono text-sm font-semibold text-slate-900">
									{calculatedNetDelivered} kg
								</div>
								<p className="mt-1 text-[11px] text-muted-foreground">Feeds Invoice quantity and revenue.</p>
							</div>
						</div>
					</div>
				</SectionCard>

				{/* Right Box: Loss Reconciliation */}
				<SectionCard title="Loss Reconciliation">
					<div className="space-y-4">
						<div className="grid grid-cols-2 gap-4">
							<div>
								<span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">EXPECTED (KG)</span>
								<div className="flex h-9 items-center rounded-md border bg-slate-100/80 px-3 font-mono text-sm font-semibold text-slate-800">
									{expectedKg} kg
								</div>
							</div>

							<div>
								<span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">DELIVERED (KG)</span>
								<div className="flex h-9 items-center rounded-md border bg-slate-100/80 px-3 font-mono text-sm font-semibold text-slate-800">
									{deliveredKg} kg
								</div>
							</div>
						</div>

						{/* Alert Box */}
						{lossKg > tolerance ? (
							<div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-900">
								<div className="flex items-center gap-2 font-medium">
									<AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
									<span>{lossKg} kg loss exceeds {tolerance} kg tolerance. Transporter recovery: {fmtKES(transporterRecoveryKES)}</span>
								</div>
								<p className="mt-1 text-[11px] text-amber-700/90 pl-6">Posts as a separate cost-ledger adjustment.</p>
							</div>
						) : lossKg > 0 ? (
							<div className="rounded-lg border border-blue-200 bg-blue-50/80 p-3.5 text-xs text-blue-900">
								<span>{lossKg} kg loss is within the {tolerance} kg tolerance limit.</span>
							</div>
						) : (
							<div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs text-emerald-900">
								<span>✓ No loss recorded. Full expected quantity delivered.</span>
							</div>
						)}
					</div>
				</SectionCard>
			</div>

			{/* Middle Section: Delivery */}
			<SectionCard title="Delivery">
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<FieldWrapper label="Customer" required error={errors.customerId}>
						<Select value={customerId} onValueChange={setCustomerId}>
							<SelectTrigger className="w-full"><SelectValue placeholder="Select customer..." /></SelectTrigger>
							<SelectContent>
								{approvedCustomers.map((c) => (
									<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FieldWrapper>
					<FieldWrapper label="Sell Rate (KES/kg)" required error={errors.sellRate}>
						<Input type="number" value={sellRate} onChange={(e) => setSellRate(e.target.value)} placeholder="Enter sell rate" />
					</FieldWrapper>
				</div>

				<div className="mt-6 space-y-2 border-t border-slate-100 pt-4">
					<div className="flex justify-between items-center text-sm">
						<div>
							<span className="text-slate-700 font-medium">Revenue</span>
							<p className="text-xs text-muted-foreground">{deliveredKg} kg customer net × KES {rateNum}/kg</p>
						</div>
						<span className="font-semibold text-slate-900">{fmtKES(revenue)}</span>
					</div>

					<div className="flex justify-between items-center text-sm">
						<div>
							<span className="text-slate-700 font-medium">Landed Cost</span>
							<p className="text-xs text-muted-foreground">{expectedKg} kg supplier net × KES {landedRatePerKg}/kg</p>
						</div>
						<span className="font-semibold text-red-600">− {fmtKES(landedCostTotal)}</span>
					</div>

					<div className="flex justify-between items-center text-sm pt-2 border-t border-slate-100">
						<span className="text-slate-900 font-semibold">Margin</span>
						<span className={`font-bold ${margin < 0 ? "text-red-600" : "text-slate-900"}`}>{fmtKES(margin)}</span>
					</div>
				</div>
			</SectionCard>

			{/* Bottom Section: Sales Invoice + eTIMS */}
			<div className="mt-6">
				<SectionCard title="Sales Invoice + eTIMS">
					<div className="space-y-1.5">
						<span className="text-xs font-semibold text-muted-foreground">Invoice Number</span>
						<div className="flex h-9 items-center rounded-md border bg-slate-100/80 px-3 font-mono text-sm text-muted-foreground">
							Generated on submit (INV-{seq.invoice})
						</div>
					</div>
				</SectionCard>
			</div>

			<div className="mt-6 flex items-center gap-3">
				<Button onClick={handleSubmit} className="bg-slate-900 hover:bg-slate-800 text-white font-semibold">
					Submit Invoice & Transmit to eTIMS
				</Button>
				<Button variant="ghost" onClick={() => navigate("/lots")}>Back to Lots</Button>
			</div>
		</div>
	);
}
