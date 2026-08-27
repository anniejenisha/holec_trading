import { DataTable, type Column } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { computeLandedCost, computePayable, computeSale, computeTransport } from "@/lib/calculations";
import { fmtKES } from "@/lib/format";
import { useStore } from "@/store/useStore";
import type { Lot } from "@/types";

export default function LedgerPage() {
	const lots = useStore((s) => s.lots);
	const findSupplier = useStore((s) => s.findSupplier);
	const findCustomer = useStore((s) => s.findCustomer);

	const costedLots = lots.filter((l) => l.state !== "TICKET");
	const settledLots = costedLots.filter((l) => l.state === "SETTLED");
	const totalMargin = settledLots.reduce((sum, l) => sum + (computeSale(l)?.margin ?? 0), 0);
	const avgMarginPerTonne = settledLots.length
		? settledLots.reduce((sum, l) => sum + (computeSale(l)?.marginPerTonne ?? 0), 0) / settledLots.length
		: 0;

	const buyColumns: Column<Lot>[] = [
		{ key: "ticketNo", header: "Ticket", render: (l) => <span className="font-mono text-xs">{l.ticketNo}</span> },
		{ key: "supplier", header: "Supplier", render: (l) => findSupplier(l.supplierId)?.name ?? "—" },
		{ key: "netPayable", header: "Net payable", className: "text-right", render: (l) => fmtKES(computePayable(l).netPayable) },
		{ key: "transport", header: "Transport", className: "text-right", render: (l) => fmtKES(computeTransport(l).total) },
		{ key: "landed", header: "Landed/kg", className: "text-right", render: (l) => `${fmtKES(computeLandedCost(l).perKg)}/kg` },
		{ key: "state", header: "State", render: (l) => <StatusBadge status={l.state} /> },
	];

	const soldLots = costedLots.filter((l) => l.customerId);
	const sellColumns: Column<Lot>[] = [
		{ key: "ticketNo", header: "Ticket", render: (l) => <span className="font-mono text-xs">{l.ticketNo}</span> },
		{ key: "customer", header: "Customer", render: (l) => findCustomer(l.customerId)?.name ?? "—" },
		{ key: "sellRate", header: "Sell rate", className: "text-right", render: (l) => (l.sellRatePerKg ? `${fmtKES(l.sellRatePerKg)}/kg` : "—") },
		{
			key: "revenue", header: "Revenue", className: "text-right",
			render: (l) => { const s = computeSale(l); return s ? fmtKES(s.revenue) : "—"; },
		},
		{
			key: "margin", header: "Margin/tonne", className: "text-right",
			render: (l) => { const s = computeSale(l); return s ? fmtKES(s.marginPerTonne) : "—"; },
		},
		{ key: "state", header: "State", render: (l) => <StatusBadge status={l.state} /> },
	];

	return (
		<div>
			<PageHeader title="Cost ledger & margin" />

			<div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
				<StatCard label="Settled trades" value={String(settledLots.length)} />
				<StatCard label="Total realised margin" value={fmtKES(totalMargin)} />
				<StatCard label="Average margin / tonne" value={fmtKES(avgMarginPerTonne)} />
			</div>

			<SectionCard title="Buy — supplier cost">
				<DataTable data={costedLots} columns={buyColumns} getRowId={(l) => l.id} emptyTitle="No costed lots yet." />
			</SectionCard>

			<div className="mt-4">
				<SectionCard title="Sell — customer revenue">
					<DataTable data={soldLots} columns={sellColumns} getRowId={(l) => l.id} emptyTitle="No lots sold yet." />
				</SectionCard>
			</div>
		</div>
	);
}

function StatCard({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg border bg-card p-4">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="mt-1 text-xl font-semibold">{value}</div>
		</div>
	);
}
