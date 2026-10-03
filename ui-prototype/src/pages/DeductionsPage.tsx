import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Banner } from "@/components/shared/Banner";
import { CalcRow } from "@/components/shared/CalcRow";
import { EmptyState } from "@/components/shared/EmptyState";
import { FieldWrapper } from "@/components/shared/FieldWrapper";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

	const [moisturePct, setMoisturePct] = useState<number>(lot?.moisturePct ?? 13.5);
	const [fmPct, setFmPct] = useState<number>(lot?.fmPct ?? 0);
	const [aflatoxinPpb, setAflatoxinPpb] = useState<number>(lot?.aflatoxinPpb ?? 0);
	const [reasonCode, setReasonCode] = useState<string>(lot?.reasonCodes?.[0] ?? "");

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
	const activeLot = { ...lot, moisturePct, fmPct, aflatoxinPpb };
	const p = computePayable(activeLot);

	const isMoistureHigh = moisturePct > 20;
	const isMoistureBlocked = isMoistureHigh && !reasonCode.trim();

	function handlePost() {
		if (!lot) return;
		if (isMoistureBlocked) {
			toast.error("Moisture exceeds 20%. Reason code / override required.");
			return;
		}
		postDeductions(lot.id);
		toast.success(`Lot ${lot.id} created — ${fmtKES(p.netPayable)} invoiced to ${sup?.name ?? ""}`);
		navigate(`/lots/${lot.id}`);
	}

	return (
		<div>
			<PageHeader title="Deductions & payable engine" />
			<p className="mb-4 -mt-3 text-sm text-muted-foreground">{lot.ticketNo} · {sup?.name}</p>

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

			<SectionCard title="Quality inspection">
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<FieldWrapper label="Step 2: Moisture %" required>
						<Input
							type="number"
							value={moisturePct}
							onChange={(e) => setMoisturePct(Number(e.target.value) || 0)}
						/>
					</FieldWrapper>
					<FieldWrapper label="Step 3: Foreign matter %" required>
						<Select value={String(fmPct)} onValueChange={(v) => setFmPct(Number(v))}>
							<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
							<SelectContent>
								{["0", "0.5", "1", "2", "3", "5"].map((v) => (
									<SelectItem key={v} value={v}>{v}%</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FieldWrapper>
					<FieldWrapper label="Aflatoxin ppb" required>
						<Input
							type="number"
							value={aflatoxinPpb}
							onChange={(e) => setAflatoxinPpb(Number(e.target.value) || 0)}
						/>
					</FieldWrapper>
				</div>
				<div className="mt-4">
					<FieldWrapper label="Reason code (required if wet buy > 20% or FM judgement)" span>
						<Input
							value={reasonCode}
							onChange={(e) => setReasonCode(e.target.value)}
							placeholder="Enter reason code or override justification"
						/>
					</FieldWrapper>
				</div>
			</SectionCard>

			{isMoistureHigh && (
				<div className="mt-4">
					<Banner type="warn">
						⚠️ Moisture at {moisturePct}% exceeds the 20% limit (Wet buy block). Reason code / override required to proceed.
					</Banner>
				</div>
			)}

			<div className="mt-4">
				<SectionCard title="Deduction breakdown">
					<CalcRow label="Step 1: Weight — Gross weight" value={fmtKg(lot.grossKg ?? 0)} />
					<CalcRow label="Tare weight" value={`− ${fmtKg(lot.tareKg ?? 0)}`} neg />
					<CalcRow label="Net weight" value={fmtKg(p.netKg)} sub="Gross minus tare" />
					<CalcRow
						label="Step 2: Moisture deduction" value={`− ${fmtKg(p.moistureDeductionKg)}`} neg
						sub={p.moistureExcess > 0 ? `${moisturePct}% recorded: ${p.moistureExcess.toFixed(1)}% excess → Bag size ${p.bagSize.toFixed(1)} kg → Moisture-adjusted ${fmtKg(p.moistureAdjustedKg)}` : `${moisturePct}% recorded — at or below 13.5% standard, no deduction`}
					/>
					<CalcRow
						label="Step 3: Foreign matter deduction" value={`− ${fmtKg(p.fmDeductionKg)}`} neg
						sub={p.fmDeductedPct > 0 ? `${fmPct}% recorded: ${p.fmDeductedPct.toFixed(1)}% deducted` : `${fmPct}% recorded — within 0.5% allowance, no deduction`}
					/>
					<CalcRow label="Accepted net quantity" value={fmtKg(p.acceptedNetKg)} total sub="This is what lands in the stock ledger — not the gross weight" />
				</SectionCard>
			</div>

			<div className="mt-4">
				<SectionCard title="Payable value">
					<CalcRow label="Reference rate" value={`${fmtKES(p.refRatePerKg)} /kg`} />
					<CalcRow label="Gross value" value={fmtKES(p.grossValue)} sub={`${fmtKg(p.acceptedNetKg)} × rate`} />
					<CalcRow label="Bagging deduction" value={`− ${fmtKES(p.baggingDeduction)}`} neg sub={`${lot.bags ?? 0} bags × KES 25`} />
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
				<Button disabled={!p.aflatoxinPass || isMoistureBlocked} onClick={handlePost}>Post net invoice & create lot</Button>
				<Button variant="ghost" onClick={() => navigate("/lots")}>Back to lots</Button>
			</div>
		</div>
	);
}

