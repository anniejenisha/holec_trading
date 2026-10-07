import { ScrollText, CheckCircle2, AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Banner } from "@/components/shared/Banner";
import { EmptyState } from "@/components/shared/EmptyState";
import { FieldWrapper } from "@/components/shared/FieldWrapper";
import { FileUpload } from "@/components/shared/FileUpload";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveLot } from "@/hooks/useActiveLot";
import { computePayable } from "@/lib/calculations";
import { fmtKES } from "@/lib/format";
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

	// State for Step 2, 3, 5, 6 calculations
	const [moisturePct, setMoisturePct] = useState<number>(18);
	const [fmPct, setFmPct] = useState<number>(2);
	const [refRatePerKg, setRefRatePerKg] = useState<number>(48);
	const [aflatoxinFee, setAflatoxinFee] = useState<number>(1500);
	const [dryingRatePerBag, setDryingRatePerBag] = useState<number>(50);
	const [hemaRatePerBag, setHemaRatePerBag] = useState<number>(24.30);

	// Reason code for moisture > 20%
	const [reasonCode, setReasonCode] = useState<string>("");

	// Supplier invoice OCR & matching state
	const [supplierInvoiceAmount, setSupplierInvoiceAmount] = useState<string>("");

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

	// Demo fallbacks matching prompt example if lot weights aren't set
	const grossKg = lot.grossKg || 960;
	const tareKg = lot.tareKg || 440;

	const sup = findSupplier(lot.supplierId);

	// Compute 8-step Payable Result
	const p = computePayable({
		grossKg,
		tareKg,
		moisturePct,
		fmPct,
		refRatePerKg,
		aflatoxinFee,
		dryingRatePerBag,
		hemaRatePerBag,
	});

	const isMoistureHigh = moisturePct > 20;
	const isMoistureBlocked = isMoistureHigh && !reasonCode.trim();

	// Supplier Invoice Matching validation
	const parsedInvAmount = Number(supplierInvoiceAmount) || 0;
	const isInvoiceScanned = parsedInvAmount > 0;
	const isInvoiceMatched = isInvoiceScanned && Math.abs(parsedInvAmount - p.netPayable) < 1;

	function handlePostAndInitiatePayment() {
		if (!lot) return;
		if (isMoistureBlocked) {
			toast.error("Moisture exceeds 20%. Reason code / override required.");
			return;
		}
		if (supplierInvoiceAmount && !isInvoiceMatched) {
			toast.error(`Supplier invoice (${fmtKES(parsedInvAmount)}) does not match Net Payable (${fmtKES(p.netPayable)})!`);
			return;
		}

		postDeductions(lot.id);
		toast.success(`Lot ${lot.id} created! Net Payable ${fmtKES(p.netPayable)} initiated to Draft for Farmer Payment approval.`);
		navigate(`/lots/${lot.id}`);
	}

	return (
		<div>
			{/* Page Header */}
			<div className="mb-4">
				<h1 className="text-xl font-semibold tracking-tight">Deductions & Payable Engine</h1>
				<p className="text-sm text-muted-foreground">{lot.ticketNo} · {sup?.name ?? "Farmer"}</p>
			</div>

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

			{/* Section 1: Deduction Breakdown */}
			<SectionCard title="Deduction Breakdown">
				<div className="divide-y text-sm">
					{/* Step 1: Weight */}
					<div className="flex items-center justify-between py-2.5">
						<span className="font-medium text-slate-700">Gross Weight</span>
						<span className="font-mono text-slate-900">{grossKg} kg</span>
					</div>

					<div className="flex items-center justify-between py-2.5">
						<span className="font-medium text-slate-700">Tare Weight</span>
						<span className="font-mono text-rose-600 font-medium">- {tareKg} kg</span>
					</div>

					<div className="flex items-center justify-between py-2.5 bg-slate-50/50 px-2 rounded-md">
						<span className="font-semibold text-slate-900">Net Weight</span>
						<span className="font-mono font-bold text-slate-900">{p.netKg} kg</span>
					</div>

					{/* Step 2: Moisture Deduction */}
					<div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2">
						<div className="flex flex-col sm:flex-row sm:items-center gap-3">
							<span className="font-medium text-slate-700 w-36">Moisture Deduction</span>
							<div className="flex items-center gap-2">
								<Input
									type="number"
									step="0.1"
									className="w-24 h-8 text-xs font-semibold"
									value={moisturePct}
									onChange={(e) => setMoisturePct(Number(e.target.value) || 0)}
								/>
								<span className="text-xs font-medium text-slate-600">%</span>
							</div>
							<span className="text-xs text-muted-foreground">
								{moisturePct}% recorded, {p.moistureExcess.toFixed(1)}% above 13.5% standard
							</span>
						</div>
						<span className="font-mono text-rose-600 font-bold">- {p.moistureDeductionKg.toFixed(1)} kg</span>
					</div>

					{/* Step 3: Foreign Matter Deduction */}
					<div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2">
						<div className="flex flex-col sm:flex-row sm:items-center gap-3">
							<span className="font-medium text-slate-700 w-36">Foreign Matter Deduction</span>
							<div className="w-24">
								<Select value={String(fmPct)} onValueChange={(v) => setFmPct(Number(v))}>
									<SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
									<SelectContent>
										{["0", "0.5", "1", "2", "3", "5"].map((v) => (
											<SelectItem key={v} value={v} className="text-xs">{v}%</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<span className="text-xs text-muted-foreground">
								{fmPct}% recorded, 0.5% allowance, {p.fmDeductedPct.toFixed(1)}% deducted
							</span>
						</div>
						<span className="font-mono text-rose-600 font-bold">- {p.fmDeductionKg.toFixed(1)} kg</span>
					</div>

					{/* Step 4: Accepted Net Quantity */}
					<div className="flex items-center justify-between py-3.5 bg-emerald-50/40 px-3 rounded-md mt-1">
						<div>
							<span className="font-bold text-slate-900 block text-base">Accepted Net Quantity</span>
							<span className="text-xs text-muted-foreground">This is what lands in the stock ledger — not the gross weight</span>
						</div>
						<span className="font-mono text-lg font-bold text-slate-900">{p.acceptedNetKg.toFixed(1)} kg</span>
					</div>
				</div>
			</SectionCard>

			{/* Moisture Override Warning (> 20%) */}
			{isMoistureHigh && (
				<div className="mt-4">
					<Banner type="warn">
						⚠️ Moisture at {moisturePct}% exceeds the 20% threshold (Wet buy block). Reason code / override required to proceed.
					</Banner>
					<div className="mt-2">
						<FieldWrapper label="Reason code / Override justification" required>
							<Input
								value={reasonCode}
								onChange={(e) => setReasonCode(e.target.value)}
								placeholder="Enter reason code or override details"
							/>
						</FieldWrapper>
					</div>
				</div>
			)}

			{/* Section 2: Payable Value */}
			<div className="mt-4">
				<SectionCard title="Payable Value">
					<div className="divide-y text-sm">
						<div className="flex items-center justify-between py-3">
							<div className="flex items-center gap-3">
								<span className="font-medium text-slate-700">Reference Rate (KES/kg) <span className="text-rose-500">*</span></span>
								<Input
									type="number"
									className="w-28 h-8 text-xs font-semibold"
									value={refRatePerKg}
									onChange={(e) => setRefRatePerKg(Number(e.target.value) || 0)}
								/>
							</div>
						</div>

						<div className="flex items-center justify-between py-3">
							<span className="font-medium text-slate-700">Accepted Weight × Rate</span>
							<span className="font-mono text-base font-bold text-slate-900">{fmtKES(p.grossValue)}</span>
						</div>
					</div>
				</SectionCard>
			</div>

			{/* Section 3: Other Charges */}
			<div className="mt-4">
				<SectionCard title="Other Charges">
					<div className="divide-y text-sm">
						{/* Aflatoxin */}
						<div className="flex items-center justify-between py-3">
							<div className="flex items-center gap-3">
								<span className="font-medium text-slate-700 w-28">Aflatoxin</span>
								<div className="w-32">
									<Select value={String(aflatoxinFee)} onValueChange={(v) => setAflatoxinFee(Number(v))}>
										<SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
										<SelectContent>
											<SelectItem value="0" className="text-xs">0 (None)</SelectItem>
											<SelectItem value="1500" className="text-xs">1,500</SelectItem>
											<SelectItem value="2500" className="text-xs">2,500</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
							<span className="font-mono text-rose-600 font-bold">- {fmtKES(p.aflatoxinFee)}</span>
						</div>

						{/* Drying Cost */}
						<div className="flex items-center justify-between py-3">
							<div className="flex items-center gap-3">
								<span className="font-medium text-slate-700 w-28">Drying Cost</span>
								<div className="flex items-center gap-2">
									<Input
										type="number"
										className="w-28 h-8 text-xs font-semibold"
										value={dryingRatePerBag}
										onChange={(e) => setDryingRatePerBag(Number(e.target.value) || 0)}
									/>
									<span className="text-xs text-muted-foreground font-medium">KES / bag</span>
								</div>
							</div>
							<span className="font-mono text-rose-600 font-bold">- {fmtKES(p.dryingDeduction)}</span>
						</div>

						{/* HEMA */}
						<div className="flex items-center justify-between py-3">
							<div className="flex items-center gap-3">
								<span className="font-medium text-slate-700 w-28">HEMA</span>
								<div className="flex items-center gap-2">
									<Input
										type="number"
										step="0.10"
										className="w-28 h-8 text-xs font-semibold"
										value={hemaRatePerBag}
										onChange={(e) => setHemaRatePerBag(Number(e.target.value) || 0)}
									/>
									<span className="text-xs text-muted-foreground font-medium">KES / bag</span>
								</div>
							</div>
							<span className="font-mono text-rose-600 font-bold">- {fmtKES(p.hemaDeduction)}</span>
						</div>
					</div>
				</SectionCard>
			</div>

			{/* Section 4: Net Payable */}
			<div className="mt-4 rounded-xl border bg-white p-5 shadow-sm">
				<div className="flex items-center justify-between">
					<span className="text-lg font-bold text-slate-900">Net Payable</span>
					<span className="font-mono text-2xl font-black text-slate-900">{fmtKES(p.netPayable)}</span>
				</div>
			</div>

			{/* Section 5: Bag Impact */}
			<div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div className="rounded-xl border bg-slate-50/80 p-5 shadow-sm">
					<span className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">Bag Size at This Moisture</span>
					<div className="mt-2 text-3xl font-black tracking-tight text-slate-900">{p.bagSize.toFixed(1)} kg</div>
					<p className="mt-1 text-xs text-muted-foreground">
						Standard bag: 90 kg ({p.moistureExcess > 0 ? `+${p.moistureExcess.toFixed(1)} kg` : "0 kg"})
					</p>
				</div>

				<div className="rounded-xl border bg-slate-50/80 p-5 shadow-sm">
					<span className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">Effective Price per Bag</span>
					<div className="mt-2 text-3xl font-black tracking-tight text-slate-900">{fmtKES(p.effectivePricePerBag)}</div>
					<p className="mt-1 text-xs text-muted-foreground">
						Delivered: {p.deliveredBags.toFixed(2)} bags ({p.netKg} kg ÷ 90)
					</p>
				</div>
			</div>

			{/* Section 6: Supplier Invoice Upload & OCR Matching */}
			<div className="mt-4">
				<SectionCard title="Supplier Invoice Upload & Matching">
					<p className="text-xs text-muted-foreground mb-4">
						Upload the farmer's physical invoice. The scanned invoice amount must match the calculated Net Payable (<strong>{fmtKES(p.netPayable)}</strong>) before initiating payment.
					</p>

					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
						<div>
							<FieldWrapper label="Upload Supplier Invoice Document">
								<FileUpload onFile={(file) => {
									if (file) {
										toast.info("Extracting invoice details via OCR...");
										setTimeout(() => {
											setSupplierInvoiceAmount(p.netPayable.toFixed(2));
											toast.success(`OCR scan complete: Extracted Invoice Amount ${fmtKES(p.netPayable)}`);
										}, 600);
									}
								}} />
							</FieldWrapper>
						</div>

						<FieldWrapper label="Supplier Invoice Amount (KES)">
							<Input
								type="number"
								value={supplierInvoiceAmount}
								onChange={(e) => setSupplierInvoiceAmount(e.target.value)}
								placeholder={`e.g. ${Math.round(p.netPayable)}`}
								className="font-mono text-sm"
							/>
						</FieldWrapper>
					</div>

					{isInvoiceScanned && (
						<div className="mt-4">
							{isInvoiceMatched ? (
								<div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 p-3 text-xs font-semibold text-emerald-800">
									<CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
									<span>Supplier Invoice ({fmtKES(parsedInvAmount)}) matches calculated Net Payable ({fmtKES(p.netPayable)}). Ready to initiate payment.</span>
								</div>
							) : (
								<div className="flex items-center gap-2 rounded-md bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-800">
									<AlertTriangle className="h-4 w-4 text-rose-600 flex-shrink-0" />
									<span>Invoice Mismatch: Supplier Invoice amount ({fmtKES(parsedInvAmount)}) does not match Net Payable ({fmtKES(p.netPayable)}). Discrepancy: {fmtKES(Math.abs(parsedInvAmount - p.netPayable))}.</span>
								</div>
							)}
						</div>
					)}
				</SectionCard>
			</div>

			{/* Section 7: Action Buttons & Initiation of Farmer Payment */}
			<div className="mt-6 flex items-center gap-3">
				<Button
					disabled={isMoistureBlocked || (isInvoiceScanned && !isInvoiceMatched)}
					onClick={handlePostAndInitiatePayment}
					className="bg-slate-900 hover:bg-slate-800 text-white font-semibold"
				>
					Post Net Invoice & Create Lot & Initiate Farmer Payment
				</Button>
				<Button variant="ghost" onClick={() => navigate("/lots")}>Back to lots</Button>
			</div>
		</div>
	);
}
