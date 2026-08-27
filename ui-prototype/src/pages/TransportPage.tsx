import { Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Banner } from "@/components/shared/Banner";
import { EmptyState } from "@/components/shared/EmptyState";
import { FieldWrapper } from "@/components/shared/FieldWrapper";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActiveLot } from "@/hooks/useActiveLot";
import { computeLoss, computePayable } from "@/lib/calculations";
import { fmtKES, fmtKg } from "@/lib/format";
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

	const [haulage, setHaulage] = useState("");
	const [cess, setCess] = useState("");
	const [offloading, setOffloading] = useState("");
	const [delivered, setDelivered] = useState<string | null>(null);

	if (!targetId) {
		return (
			<div>
				<PageHeader title="Transport & loss" />
				<EmptyState icon={Truck} title="No lots currently in Lot state" />
			</div>
		);
	}

	if (!lot || lot.state !== "LOT") {
		return (
			<div>
				<PageHeader title="Transport & loss" />
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
	const payable = computePayable(lot);
	const expected = payable.acceptedNetKg;
	const deliveredNum = delivered !== null && delivered !== "" ? Number(delivered) : expected;
	const loss = computeLoss(expected, deliveredNum);

	function handleCapitalise() {
		if (!lot) return;
		capitaliseTransport(lot.id, { haulage: Number(haulage) || 0, cess: Number(cess) || 0, offloading: Number(offloading) || 0 });
		toast.success(`${lot.ticketNo} moved to Position`);
		navigate(`/lots/${lot.id}`);
	}

	return (
		<div>
			<PageHeader title="Transport & loss" />
			<p className="mb-4 -mt-3 text-sm text-muted-foreground">{lot.ticketNo} · {sup?.name}</p>

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

			<SectionCard title="Transport charges">
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
					<FieldWrapper label="Haulage (KES)">
						<Input type="number" value={haulage} onChange={(e) => setHaulage(e.target.value)} />
					</FieldWrapper>
					<FieldWrapper label="Cess (KES)">
						<Input type="number" value={cess} onChange={(e) => setCess(e.target.value)} />
					</FieldWrapper>
					<FieldWrapper label="Offloading (KES)">
						<Input type="number" value={offloading} onChange={(e) => setOffloading(e.target.value)} />
					</FieldWrapper>
				</div>
			</SectionCard>

			<div className="mt-4">
				<SectionCard title="Loss reconciliation">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<FieldWrapper label="Expected quantity">
							<div className="flex h-9 items-center rounded-md border bg-muted px-3 font-mono text-sm">{fmtKg(expected)}</div>
						</FieldWrapper>
						<FieldWrapper label="Delivered quantity (kg)">
							<Input
								type="number"
								value={delivered ?? Math.round(expected)}
								onChange={(e) => setDelivered(e.target.value)}
							/>
						</FieldWrapper>
					</div>
					<div className="mt-4">
						{loss.lossKg === 0 ? (
							<Banner type="ok">No loss recorded — full expected quantity delivered.</Banner>
						) : loss.withinTolerance ? (
							<Banner type="info">
								{fmtKg(loss.lossKg)} loss is within the {loss.tolerance}kg tolerance — absorbed into inventory cost, no recovery raised.
							</Banner>
						) : (
							<Banner type="warn">
								{fmtKg(loss.lossKg)} loss exceeds the {loss.tolerance}kg tolerance. {fmtKg(loss.recoverableKg)} recovered from the
								transporter at sell rate = {fmtKES(loss.recoveredKES)}, split across inventory reversal and margin recovery.
							</Banner>
						)}
					</div>
				</SectionCard>
			</div>

			<div className="mt-6 flex items-center gap-2">
				<Button onClick={handleCapitalise}>Capitalise costs & move to Position</Button>
				<Button variant="ghost" onClick={() => navigate("/lots")}>Back to lots</Button>
			</div>
		</div>
	);
}
