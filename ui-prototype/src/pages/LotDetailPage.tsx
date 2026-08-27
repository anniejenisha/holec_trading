import { useNavigate, useParams } from "react-router-dom";
import { CalcRow } from "@/components/shared/CalcRow";
import { ProgressTrack } from "@/components/shared/ProgressTrack";
import { SectionCard, SectionLabel } from "@/components/shared/SectionCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { useActiveLot } from "@/hooks/useActiveLot";
import { computeLandedCost, computePayable, computeSale, computeTransport } from "@/lib/calculations";
import { fmtKES, fmtKg } from "@/lib/format";
import { useStore } from "@/store/useStore";
import type { LotState } from "@/types";

const NEXT_STAGE: Record<string, LotState> = {
	TICKET: "INTAKE", INTAKE: "LOT", LOT: "POSITION", POSITION: "INVOICED", INVOICED: "SETTLED",
};
const NEXT_ROUTE: Record<string, string> = {
	INTAKE: "intake", LOT: "deductions", POSITION: "transport", INVOICED: "sales", SETTLED: "payments",
};

export default function LotDetailPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const lot = useStore((s) => s.lots.find((l) => l.id === id));
	const findSupplier = useStore((s) => s.findSupplier);
	const findCustomer = useStore((s) => s.findCustomer);
	const events = useStore((s) => s.events);

	useActiveLot(lot?.id);

	if (!lot) {
		return <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Lot not found.</div>;
	}

	const sup = findSupplier(lot.supplierId);
	const cus = lot.customerId ? findCustomer(lot.customerId) : null;
	const isTicketOnly = lot.state === "TICKET";
	const payable = !isTicketOnly ? computePayable(lot) : null;
	const transport = !isTicketOnly ? computeTransport(lot) : null;
	const landed = !isTicketOnly ? computeLandedCost(lot) : null;
	const sale = !isTicketOnly ? computeSale(lot) : null;

	const lotEvents = events.filter((e) => e.lotId === lot.id).slice(-6).reverse();
	const nextStage = NEXT_STAGE[lot.state];
	const nextRoute = nextStage ? NEXT_ROUTE[nextStage] : null;

	return (
		<div>
			<div className="mb-2 flex items-start justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">
						{lot.ticketNo} <span className="font-normal text-muted-foreground">· {lot.id}</span>
					</h1>
					<p className="text-sm text-muted-foreground">
						{sup?.name ?? "—"} · {lot.county ? `${lot.county}, ${lot.area}` : "origin not yet captured"}
					</p>
				</div>
				<StatusBadge status={lot.state} />
			</div>

			<ProgressTrack currentState={lot.state} />

			<SectionLabel>Overview</SectionLabel>
			<SectionCard>
				<div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
					<KV label="Supplier" value={sup?.name ?? "—"} />
					<KV label="Customer" value={cus?.name ?? "Not yet matched"} />
					<KV label="Gross weight" value={lot.grossKg ? fmtKg(lot.grossKg) : "—"} />
					<KV label="Accepted (payable) qty" value={payable ? fmtKg(payable.acceptedNetKg) : "—"} />
					<KV label="Moisture" value={lot.moisturePct ? `${lot.moisturePct}%` : "—"} />
					<KV label="Aflatoxin" value={lot.aflatoxinPpb != null ? `${lot.aflatoxinPpb} ppb` : "—"} />
				</div>
			</SectionCard>

			{payable && transport && landed && (
				<>
					<SectionLabel>Cost summary</SectionLabel>
					<SectionCard>
						<CalcRow label="Net payable to supplier" value={fmtKES(payable.netPayable)} />
						<CalcRow label="Transport & handling" value={fmtKES(transport.total)} />
						<CalcRow label="Landed cost per kg" value={`${fmtKES(landed.perKg).replace("KES", "").trim()} /kg`} total />
						{sale && <CalcRow label="Margin per tonne" value={fmtKES(sale.marginPerTonne)} />}
					</SectionCard>
				</>
			)}

			<SectionLabel>Trade event log</SectionLabel>
			<SectionCard>
				{lotEvents.length ? (
					<div className="divide-y">
						{lotEvents.map((e) => (
							<div key={e.id} className="flex items-start justify-between gap-4 py-2.5">
								<div>
									<div className="text-sm font-medium">{e.action}</div>
									{e.detail && <div className="text-xs text-muted-foreground">{e.detail}</div>}
								</div>
								<div className="shrink-0 text-right text-[11px] text-muted-foreground">
									{e.who}
									<br />
									{e.at}
								</div>
							</div>
						))}
					</div>
				) : (
					<p className="py-6 text-center text-sm text-muted-foreground">No events logged yet for this lot.</p>
				)}
			</SectionCard>

			<div className="mt-6 flex items-center gap-2">
				{nextStage && nextRoute && (
					<Button onClick={() => navigate(`/${nextRoute}/${lot.id}`)}>
						Continue to {nextStage.charAt(0) + nextStage.slice(1).toLowerCase()} →
					</Button>
				)}
				<Button variant="ghost" onClick={() => navigate("/lots")}>Back to lots</Button>
			</div>
		</div>
	);
}

function KV({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="text-sm font-medium">{value}</div>
		</div>
	);
}
