import { Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/EmptyState";
import { FieldWrapper } from "@/components/shared/FieldWrapper";
import { FileUpload } from "@/components/shared/FileUpload";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveLot } from "@/hooks/useActiveLot";
import { fmtKg } from "@/lib/format";
import { useStore } from "@/store/useStore";

export default function IntakePage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const lots = useStore((s) => s.lots);
	const suppliers = useStore((s) => s.suppliers);
	const findSupplier = useStore((s) => s.findSupplier);
	const submitIntake = useStore((s) => s.submitIntake);

	const ticketLots = useMemo(() => lots.filter((l) => l.state === "TICKET"), [lots]);
	const targetId = id ?? ticketLots[0]?.id;
	const lot = targetId ? lots.find((l) => l.id === targetId) : undefined;

	useActiveLot(lot?.id);

	const [gross, setGross] = useState("");
	const [tare, setTare] = useState("");
	const [bags, setBags] = useState("");
	const [wbNumber, setWbNumber] = useState("");
	const [transporterId, setTransporterId] = useState("");
	const [vehicleReg, setVehicleReg] = useState("");
	const [errors, setErrors] = useState<Record<string, string>>({});

	if (!targetId) {
		return (
			<div>
				<PageHeader title="Intake capture" />
				<EmptyState
					icon={Truck}
					title="No tickets waiting for intake"
					actionLabel="+ New ticket"
					onAction={() => navigate("/tickets/new")}
				/>
			</div>
		);
	}

	if (!lot || lot.state !== "TICKET") {
		return (
			<div>
				<PageHeader title="Intake capture" />
				<EmptyState title="That ticket has already been weighed" description={ticketLots.length ? "Pick another ticket below." : "No tickets currently waiting."} />
				{ticketLots.length > 0 && (
					<div className="mt-3 flex flex-wrap gap-2">
						{ticketLots.map((t) => (
							<Button key={t.id} variant="outline" size="sm" onClick={() => navigate(`/intake/${t.id}`)}>{t.ticketNo}</Button>
						))}
					</div>
				)}
			</div>
		);
	}

	const sup = findSupplier(lot.supplierId);
	const grossNum = Number(gross) || 0;
	const tareNum = Number(tare) || 0;
	const netKg = Math.max(0, grossNum - tareNum);

	function handleSubmit() {
		const next: Record<string, string> = {};
		if (!gross) next.gross = "Required";
		if (!tare) next.tare = "Required";
		if (!bags) next.bags = "Required";
		if (!wbNumber.trim()) next.wbNumber = "Required";
		if (!transporterId) next.transporterId = "Transporter is required";
		if (gross && tare && grossNum <= tareNum) next.gross = "Gross weight must exceed tare weight";
		setErrors(next);
		if (Object.keys(next).length > 0) {
			toast.error(Object.values(next)[0]);
			return;
		}

		submitIntake(lot!.id, {
			grossKg: grossNum, tareKg: tareNum, bags: Number(bags), wbNumber: wbNumber.trim(),
			transporterId: transporterId || null, vehicleReg, moisturePct: 0, fmPct: 0,
			aflatoxinPpb: 0, county: "", area: "", reasonCode: "",
		});
		toast.success(`Intake recorded for ${lot!.ticketNo}`);
		navigate(`/deductions/${lot!.id}`);
	}

	return (
		<div>
			<PageHeader title="Intake capture" />
			<p className="mb-4 -mt-3 text-sm text-muted-foreground">{lot.ticketNo} · {sup?.name}</p>

			{ticketLots.length > 1 && (
				<div className="mb-4 flex flex-wrap items-center gap-1.5">
					<span className="text-xs text-muted-foreground">{ticketLots.length} tickets waiting:</span>
					{ticketLots.map((t) => (
						<Button key={t.id} size="sm" variant={t.id === lot.id ? "default" : "outline"} onClick={() => navigate(`/intake/${t.id}`)}>
							{t.ticketNo}
						</Button>
					))}
				</div>
			)}

			<SectionCard title="Weighbridge capture">
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<FieldWrapper label="Gross weight (kg)" required error={errors.gross}>
						<Input type="number" value={gross} onChange={(e) => setGross(e.target.value)} />
					</FieldWrapper>
					<FieldWrapper label="Tare weight (kg)" required error={errors.tare}>
						<Input type="number" value={tare} onChange={(e) => setTare(e.target.value)} />
					</FieldWrapper>
					<FieldWrapper label="Bag count" required error={errors.bags}>
						<Input type="number" value={bags} onChange={(e) => setBags(e.target.value)} />
					</FieldWrapper>
					<FieldWrapper label="Weighbridge ticket number" required error={errors.wbNumber}>
						<Input value={wbNumber} onChange={(e) => setWbNumber(e.target.value)} placeholder="Unique, e.g. WB-88213" />
					</FieldWrapper>
					<FieldWrapper label="Transporter" required error={errors.transporterId}>
						<Select value={transporterId} onValueChange={setTransporterId}>
							<SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
							<SelectContent>
								{suppliers.filter((s) => s.group === "Transporter" || s.group === "Transporters").map((s) => (
									<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FieldWrapper>
					<FieldWrapper label="Vehicle registration">
						<Input value={vehicleReg} onChange={(e) => setVehicleReg(e.target.value)} placeholder="e.g. KDA 221C" />
					</FieldWrapper>
				</div>
				<div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
					<FieldWrapper label="Weighbridge slip — gross (in)">
						<FileUpload />
					</FieldWrapper>
					<FieldWrapper label="Weighbridge slip — tare (out)">
						<FileUpload />
					</FieldWrapper>
				</div>
				<div className="mt-4">
					<FieldWrapper label="Net weight (calculated)" span>
						<div className="flex h-9 items-center rounded-md border bg-muted px-3 font-mono text-sm">{fmtKg(netKg)}</div>
					</FieldWrapper>
				</div>
			</SectionCard>

			<div className="mt-6 flex items-center gap-2">
				<Button onClick={handleSubmit}>Submit intake & create lot</Button>
				<Button variant="ghost" onClick={() => navigate("/lots")}>Cancel</Button>
		</div>
	);
}
