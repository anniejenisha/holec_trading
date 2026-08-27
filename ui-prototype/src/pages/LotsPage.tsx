import { Wheat } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { computePayable } from "@/lib/calculations";
import { fmtKg } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useStore } from "@/store/useStore";
import { STAGE_ORDER, type Lot, type LotState } from "@/types";

export default function LotsPage() {
	const lots = useStore((s) => s.lots);
	const findSupplier = useStore((s) => s.findSupplier);
	const navigate = useNavigate();
	const [filter, setFilter] = useState<LotState | "ALL">("ALL");

	const filtered = lots.filter((l) => filter === "ALL" || l.state === filter).slice().reverse();
	const stateCounts = STAGE_ORDER.reduce<Record<LotState, number>>(
		(acc, s) => {
			acc[s] = lots.filter((l) => l.state === s).length;
			return acc;
		},
		{} as Record<LotState, number>,
	);

	const columns: Column<Lot>[] = [
		{ key: "ticketNo", header: "Ticket", render: (l) => <span className="font-mono text-xs">{l.ticketNo}</span>, sortValue: (l) => l.ticketNo },
		{ key: "id", header: "Lot ID", render: (l) => <span className="font-mono text-xs">{l.id}</span> },
		{ key: "supplier", header: "Supplier", render: (l) => findSupplier(l.supplierId)?.name ?? "—" },
		{ key: "origin", header: "Origin", render: (l) => (l.county ? `${l.county}${l.area ? ` · ${l.area}` : ""}` : "—") },
		{
			key: "qty", header: "Quantity", className: "text-right",
			render: (l) => fmtKg(l.state === "TICKET" ? (l.itemQty ?? 0) : computePayable(l).acceptedNetKg),
		},
		{ key: "state", header: "State", render: (l) => <StatusBadge status={l.state} /> },
	];

	return (
		<div>
			<PageHeader title="Lots" count={lots.length} />

			<div className="mb-3 flex flex-wrap items-center gap-1.5">
				{(["ALL", ...STAGE_ORDER] as const).map((s) => (
					<button
						key={s}
						type="button"
						onClick={() => setFilter(s)}
						className={cn(
							"rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
							filter === s ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
						)}
					>
						{s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
						{s !== "ALL" && ` (${stateCounts[s]})`}
					</button>
				))}
				<div className="flex-1" />
				<Button onClick={() => navigate("/tickets/new")}>+ New ticket</Button>
			</div>

			{filtered.length === 0 ? (
				<EmptyState icon={Wheat} title="No lots at this stage" />
			) : (
				<DataTable data={filtered} columns={columns} getRowId={(l) => l.id} onRowClick={(l) => navigate(`/lots/${l.id}`)} />
			)}
		</div>
	);
}
