import { ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { CalcRow } from "@/components/shared/CalcRow";
import { EmptyState } from "@/components/shared/EmptyState";
import { FieldWrapper } from "@/components/shared/FieldWrapper";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveLot } from "@/hooks/useActiveLot";
import { computeLandedCost, computePayable } from "@/lib/calculations";
import { fmtKES, fmtKg } from "@/lib/format";
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
	const [errors, setErrors] = useState<Record<string, string>>({});

	if (!targetId) {
		return (
			<div>
				<PageHeader title="Sale & invoicing" />
				<EmptyState icon={ShoppingCart} title="No lots currently held in Position" />
			</div>
		);
	}

	if (!lot || lot.state !== "POSITION") {
		return (
			<div>
				<PageHeader title="Sale & invoicing" />
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

	const rateNum = Number(sellRate) || 0;
	const revenue = payable.acceptedNetKg * rateNum;
	const margin = revenue - landed.totalCost;
	const marginPerTonne = (margin / payable.acceptedNetKg) * 1000;

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
		navigate(`/lots/${lot.id}`);
	}

	return (
		<div>
			<PageHeader title="Sale & invoicing" />
			<p className="mb-4 -mt-3 text-sm text-muted-foreground">{lot.ticketNo} · {sup?.name} → {fmtKg(payable.acceptedNetKg)} @ {fmtKES(landed.perKg)}/kg landed</p>

			{positionLots.length > 1 && (
				<div className="mb-4 flex flex-wrap items-center gap-1.5">
					<span className="text-xs text-muted-foreground">{positionLots.length} lots ready:</span>
					{positionLots.map((t) => (
						<Button key={t.id} size="sm" variant={t.id === lot.id ? "default" : "outline"} onClick={() => navigate(`/sales/${t.id}`)}>
							{t.ticketNo}
						</Button>
					))}
				</div>
			)}

			<SectionCard title="Delivery">
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<FieldWrapper label="Customer" required error={errors.customerId}>
						<Select value={customerId} onValueChange={setCustomerId}>
							<SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
							<SelectContent>
								{approvedCustomers.map((c) => (
									<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FieldWrapper>
					<FieldWrapper label="Sell rate (KES/kg)" required error={errors.sellRate}>
						<Input type="number" value={sellRate} onChange={(e) => setSellRate(e.target.value)} />
					</FieldWrapper>
				</div>
				{rateNum > 0 && (
					<div className="mt-4">
						<CalcRow label="Revenue" value={fmtKES(revenue)} />
						<CalcRow label="Landed cost" value={`− ${fmtKES(landed.totalCost)}`} neg />
						<CalcRow label="Margin per tonne" value={fmtKES(marginPerTonne)} total neg={margin < 0} />
					</div>
				)}
			</SectionCard>

			<div className="mt-4">
				<SectionCard title="Sales invoice + eTIMS">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<FieldWrapper label="Invoice number">
							<div className="flex h-9 items-center rounded-md border bg-muted px-3 font-mono text-sm">INV-{seq.invoice}</div>
						</FieldWrapper>
						<FieldWrapper label="eTIMS control unit number">
							<div className="flex h-9 items-center rounded-md border bg-muted px-3 font-mono text-sm text-muted-foreground">Generated on submit</div>
						</FieldWrapper>
					</div>
				</SectionCard>
			</div>

			<div className="mt-6 flex items-center gap-2">
				<Button onClick={handleSubmit}>Submit invoice & transmit to eTIMS</Button>
				<Button variant="ghost" onClick={() => navigate("/lots")}>Back to lots</Button>
			</div>
		</div>
	);
}
