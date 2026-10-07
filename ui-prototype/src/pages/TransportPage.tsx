import { Truck, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActiveLot } from "@/hooks/useActiveLot";
import { computePayable } from "@/lib/calculations";
import { fmtKES } from "@/lib/format";
import { useStore } from "@/store/useStore";

export default function TransportPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const lots = useStore((s) => s.lots);
	const findSupplier = useStore((s) => s.findSupplier);
	const capitaliseTransport = useStore((s) => s.capitaliseTransport);

	const lotLots = useMemo(() => lots.filter((l) => l.state === "LOT"), [lots]);
	const targetId = id ?? lotLots[0]?.id;
	const lot = targetId ? lots.find((l) => l.id === targetId) : undefined;

	useActiveLot(lot?.id);

	// Default values matching prompt specs / screenshot
	const [haulageRatePerBag] = useState<number>(180); // Read-only allocated at Lot stage
	const [cessAmount, setCessAmount] = useState<string>("1250"); // Single amount in KES typed by user
	const [offloadingRatePerBag, setOffloadingRatePerBag] = useState<string>("35"); // Rate per bag typed by user

	if (!targetId) {
		return (
			<div>
				<PageHeader title="Transport Costs" />
				<EmptyState icon={Truck} title="No lots currently waiting for transport costs" />
			</div>
		);
	}

	if (!lot || lot.state !== "LOT") {
		return (
			<div>
				<PageHeader title="Transport Costs" />
				<EmptyState title="That lot has moved on" description={lotLots.length ? "Pick another lot below." : "No lots currently waiting."} />
				{lotLots.length > 0 && (
					<div className="mt-3 flex flex-wrap gap-2">
						{lotLots.map((t) => (
							<Button key={t.id} variant="outline" size="sm" onClick={() => navigate(`/transport/${t.id}`)}>{t.ticketNo}</Button>
						))}
					</div>
				)}
			</div>
		);
	}

	const sup = findSupplier(lot.supplierId);
	computePayable(lot);
	
	// Bags pre-filled from lot (default 520 bags if not set)
	const bagsCount = lot.bags || Math.round((lot.grossKg ? lot.grossKg - (lot.tareKg || 0) : 46800) / 90) || 520;

	// Calculations
	const haulageTotal = haulageRatePerBag * bagsCount;
	const cessNum = Number(cessAmount) || 0;
	const offloadingRateNum = Number(offloadingRatePerBag) || 0;
	const offloadingTotal = offloadingRateNum * bagsCount;

	function handleCapitalise() {
		if (!lot) return;
		capitaliseTransport(lot.id, {
			haulage: haulageTotal,
			cess: cessNum,
			offloading: offloadingTotal,
		});
		toast.success(`${lot.ticketNo} costs capitalised — moved to Position`);
		navigate(`/lots/${lot.id}`);
	}

	return (
		<div>
			<div className="mb-4">
				<h1 className="text-xl font-semibold tracking-tight">Transport Costs</h1>
				<p className="text-sm text-muted-foreground">{lot.ticketNo} · {sup?.name ?? "Supplier"}</p>
			</div>

			{lotLots.length > 1 && (
				<div className="mb-4 flex flex-wrap items-center gap-1.5">
					<span className="text-xs text-muted-foreground">{lotLots.length} lots ready:</span>
					{lotLots.map((t) => (
						<Button key={t.id} size="sm" variant={t.id === lot.id ? "default" : "outline"} onClick={() => navigate(`/transport/${t.id}`)}>
							{t.ticketNo}
						</Button>
					))}
				</div>
			)}

			<SectionCard title="Transport Charges">
				<div className="space-y-6">
					{/* Haulage Row */}
					<div className="space-y-1.5">
						<div className="flex items-center gap-2">
							<span className="font-semibold text-slate-900 text-sm">Haulage</span>
							<span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-700/10">
								Allocated at Lot
							</span>
						</div>
						<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
							<div>
								<span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">RATE / BAG</span>
								<div className="flex h-9 items-center rounded-md border bg-slate-100/80 px-3 font-mono text-sm font-semibold text-slate-800">
									KES {haulageRatePerBag}
								</div>
								<p className="mt-1 text-[11px] text-muted-foreground">Transporter charge already allocated at Lot stage.</p>
							</div>

							<div>
								<span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">BAGS</span>
								<div className="flex h-9 items-center rounded-md border bg-slate-100/80 px-3 font-mono text-sm font-semibold text-slate-800">
									{bagsCount}
								</div>
							</div>

							<div>
								<span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">TOTAL</span>
								<div className="flex h-9 items-center rounded-md border bg-slate-100/80 px-3 font-mono text-sm font-bold text-slate-900">
									{fmtKES(haulageTotal)}
								</div>
							</div>
						</div>
					</div>

					<hr className="border-slate-100" />

					{/* Cess Row */}
					<div className="space-y-1.5">
						<span className="font-semibold text-slate-900 text-sm block">Cess</span>
						<div className="max-w-md">
							<span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">AMOUNT (KES)</span>
							<Input
								type="number"
								value={cessAmount}
								onChange={(e) => setCessAmount(e.target.value)}
								className="font-mono text-sm font-semibold h-9"
								placeholder="e.g. 1250"
							/>
						</div>
					</div>

					<hr className="border-slate-100" />

					{/* Offloading (casuals) Row */}
					<div className="space-y-1.5">
						<span className="font-semibold text-slate-900 text-sm block">Offloading (casuals)</span>
						<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
							<div>
								<span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">RATE / BAG</span>
								<div className="relative">
									<Input
										type="number"
										value={offloadingRatePerBag}
										onChange={(e) => setOffloadingRatePerBag(e.target.value)}
										className="font-mono text-sm font-semibold h-9 pl-12"
										placeholder="35"
									/>
									<span className="absolute left-3 top-2 text-xs font-semibold text-muted-foreground">KES</span>
								</div>
								<p className="mt-1 text-[11px] text-muted-foreground">Rate × bags. Bags are pre-filled from the lot.</p>
							</div>

							<div>
								<span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">BAGS</span>
								<div className="flex h-9 items-center rounded-md border bg-slate-100/80 px-3 font-mono text-sm font-semibold text-slate-800">
									{bagsCount}
								</div>
							</div>

							<div>
								<span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">TOTAL</span>
								<div className="flex h-9 items-center rounded-md border bg-slate-100/80 px-3 font-mono text-sm font-bold text-slate-900">
									{fmtKES(offloadingTotal)}
								</div>
							</div>
						</div>
					</div>

					{/* Offloading Banner */}
					<div className="mt-4 flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 text-xs text-slate-700">
						<Info className="h-4 w-4 text-blue-600 flex-shrink-0" />
						<span>Offloading is borne by customer. It will be recharged on the invoice, not added to landed cost.</span>
					</div>
				</div>
			</SectionCard>

			{/* Action Buttons */}
			<div className="mt-6 flex items-center gap-3">
				<Button onClick={handleCapitalise} className="bg-slate-900 hover:bg-slate-800 text-white font-semibold">
					Capitalise Costs & Move to Position
				</Button>
				<Button variant="ghost" onClick={() => navigate("/lots")}>Back to Lots</Button>
			</div>
		</div>
	);
}
