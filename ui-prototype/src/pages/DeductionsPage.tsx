import { ScrollText } from "lucide-react";
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Banner } from "@/components/shared/Banner";
import { CalcRow } from "@/components/shared/CalcRow";
import { EmptyState } from "@/components/shared/EmptyState";
import { FieldWrapper } from "@/components/shared/FieldWrapper";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { useActiveLot } from "@/hooks/useActiveLot";
import { computePayable } from "@/lib/calculations";
import { fmtKES, fmtKg } from "@/lib/format";
import { useStore } from "@/store/useStore";

export default function DeductionsPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const lots = useStore((s) => s.lots);
	const findSupplier = useStore((s) => s.findSupplier);
	const postDeductions = useStore((s) => s.postDeductions);

	const intakeLots = useMemo(() => lots.filter((l) => l.state === "INTAKE"), [lots]);
	const targetId = id ?? intakeLots[0]?.id;
	const lot = targetId ? lots.find((l) => l.id === targetId) : undefined;

	useActiveLot(lot?.id);

	if (!targetId) {
		return (
			<div>
				<PageHeader title="Deductions & payable engine" />
				<EmptyState icon={ScrollText} title="No lots waiting for payable calculation" />
			</div>
		);
	}

	if (!lot || lot.state !== "INTAKE") {
		return (
			<div>
				<PageHeader title="Deductions & payable engine" />
				<EmptyState title="That lot has already been costed" description={intakeLots.length ? "Pick another lot below." : "No lots currently waiting."} />
				{intakeLots.length > 0 && (
					<div className="mt-3 flex flex-wrap gap-2">
						{intakeLots.map((t) => (
							<Button key={t.id} variant="outline" size="sm" onClick={() => navigate(`/deductions/${t.id}`)}>{t.ticketNo}</Button>
						))}
					</div>
				)}
			</div>
		);
	}

	const sup = findSupplier(lot.supplierId);
	const p = computePayable(lot);

	function handlePost() {
		if (!lot) return;
		postDeductions(lot.id);
		toast.success(`Lot ${lot.id} created — ${fmtKES(p.netPayable)} invoiced to ${sup?.name ?? ""}`);
		navigate(`/lots/${lot.id}`);
	}

	return (
		<div>
			<PageHeader title="Deductions & payable engine" />

			{intakeLots.length > 1 && (
				<div className="mb-4 flex flex-wrap items-center gap-1.5">
					<span className="text-xs text-muted-foreground">{intakeLots.length} lots ready:</span>
					{intakeLots.map((t) => (
						<Button key={t.id} size="sm" variant={t.id === lot.id ? "default" : "outline"} onClick={() => navigate(`/deductions/${t.id}`)}>
							{t.ticketNo}
						</Button>
					))}
				</div>
			)}

			<SectionCard title="Deduction breakdown">
				<CalcRow label="Gross weight" value={fmtKg(lot.grossKg ?? 0)} />
				<CalcRow label="Tare weight" value={`− ${fmtKg(lot.tareKg ?? 0)}`} neg />
				<CalcRow label="Net weight" value={fmtKg(p.netKg)} sub="Gross minus tare" />
				<CalcRow
					label={`Moisture deduction (${p.band})`} value={`− ${fmtKg(p.moistureDeductionKg)}`} neg
					sub={`${lot.moisturePct}% recorded vs 13.5% standard`}
				/>
				<CalcRow label="Foreign matter deduction" value={`− ${fmtKg(p.fmDeductionKg)}`} neg sub={`${lot.fmPct}% recorded`} />
				<CalcRow label="Accepted net quantity" value={fmtKg(p.acceptedNetKg)} total sub="This is what lands in the stock ledger — not the gross weight" />
			</SectionCard>

			<div className="mt-4">
				<SectionCard title="Payable value">
					<CalcRow label="Reference rate" value={`${fmtKES(p.refRatePerKg)} /kg`} />
					<CalcRow label="Gross value" value={fmtKES(p.grossValue)} sub={`${fmtKg(p.acceptedNetKg)} × rate`} />
					<CalcRow label="Bagging deduction" value={`− ${fmtKES(p.baggingDeduction)}`} neg sub={`${lot.bags} bags × KES 25`} />
					<CalcRow label="Aflatoxin test fee" value={`− ${fmtKES(p.aflatoxinTestFee)}`} neg />
					<CalcRow label="Net payable to supplier" value={fmtKES(p.netPayable)} total />
				</SectionCard>
			</div>

			{!p.aflatoxinPass && (
				<div className="mt-4">
					<Banner type="block">Aflatoxin result exceeds the limit. This lot is blocked from proceeding without an override.</Banner>
				</div>
			)}

			<div className="mt-4">
				<SectionCard title="Net supplier invoice">
					<FieldWrapper label="Invoice value" span>
						<div className="flex h-9 items-center rounded-md border bg-muted px-3 font-mono text-sm">{fmtKES(p.netPayable)}</div>
					</FieldWrapper>
				</SectionCard>
			</div>

			<div className="mt-6 flex items-center gap-2">
				<Button disabled={!p.aflatoxinPass} onClick={handlePost}>Post net invoice & create lot</Button>
				<Button variant="ghost" onClick={() => navigate("/lots")}>Back to lots</Button>
			</div>
		</div>
	);
}
