import { DataTable, type Column } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { useStore } from "@/store/useStore";
import type { TradeEvent } from "@/types";

export default function EventLogPage() {
	const events = useStore((s) => s.events);
	const findLot = useStore((s) => s.findLot);

	const rows = events.slice().reverse();

	const columns: Column<TradeEvent>[] = [
		{ key: "lot", header: "Lot", render: (e) => <span className="font-mono text-xs">{findLot(e.lotId)?.ticketNo ?? e.lotId}</span> },
		{ key: "action", header: "Action", render: (e) => <span className="font-medium">{e.action}</span> },
		{ key: "detail", header: "Detail", render: (e) => <span className="text-muted-foreground">{e.detail ?? ""}</span> },
		{ key: "who", header: "Who", render: (e) => e.who },
		{ key: "at", header: "When", render: (e) => <span className="whitespace-nowrap text-xs text-muted-foreground">{e.at}</span> },
	];

	return (
		<div>
			<PageHeader title="Trade event log" count={events.length} />
			<SectionCard title="All events">
				<DataTable data={rows} columns={columns} getRowId={(e) => e.id} emptyTitle="No events logged yet." />
			</SectionCard>
		</div>
	);
}
