import { Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useStore } from "@/store/useStore";
import type { Supplier } from "@/types";

export default function SuppliersPage() {
	const suppliers = useStore((s) => s.suppliers);
	const navigate = useNavigate();

	const columns: Column<Supplier>[] = [
		{ key: "id", header: "ID", render: (s) => <span className="font-mono text-xs">{s.id}</span>, sortValue: (s) => s.id },
		{ key: "name", header: "Name", render: (s) => <span className="font-medium">{s.name}</span>, sortValue: (s) => s.name },
		{ key: "group", header: "Group", render: (s) => s.group || "—", sortValue: (s) => s.group },
		{ key: "county", header: "County", render: (s) => s.county || "—", sortValue: (s) => s.county },
		{ key: "kraPin", header: "KRA PIN", render: (s) => <span className="font-mono text-xs">{s.kraPin || "—"}</span> },
		{ key: "status", header: "Status", render: (s) => <StatusBadge status={s.status} /> },
	];

	return (
		<div>
			<PageHeader
				title="Suppliers"
				count={suppliers.length}
			/>
			{suppliers.length === 0 ? (
				<EmptyState
					icon={Users}
					title="No suppliers yet"
					actionLabel="+ New supplier"
					onAction={() => navigate("/suppliers/new")}
				/>
			) : (
				<DataTable
					data={suppliers}
					columns={columns}
					getRowId={(s) => s.id}
					onRowClick={(s) => navigate(`/suppliers/${s.id}`)}
					searchPlaceholder="Search by name or KRA PIN"
					searchFn={(s, q) => s.name.toLowerCase().includes(q) || s.kraPin.toLowerCase().includes(q)}
					toolbarRight={
						<Button onClick={() => navigate("/suppliers/new")}>+ New supplier</Button>
					}
				/>
			)}
		</div>
	);
}
