import { Landmark } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { fmtKES } from "@/lib/format";
import { useStore } from "@/store/useStore";
import type { Customer } from "@/types";

export default function CustomersPage() {
	const customers = useStore((s) => s.customers);
	const navigate = useNavigate();

	const columns: Column<Customer>[] = [
		{ key: "id", header: "ID", render: (c) => <span className="font-mono text-xs">{c.id}</span>, sortValue: (c) => c.id },
		{ key: "name", header: "Name", render: (c) => <span className="font-medium">{c.name}</span>, sortValue: (c) => c.name },
		{ key: "group", header: "Group", render: (c) => c.group || "—" },
		{
			key: "creditLimit", header: "Credit limit",
			render: (c) => (c.creditLimit ? fmtKES(c.creditLimit) : "—"),
			sortValue: (c) => c.creditLimit, className: "text-right",
		},
		{ key: "creditTerms", header: "Terms", render: (c) => c.creditTerms || "—" },
		{ key: "status", header: "Status", render: (c) => <StatusBadge status={c.status} /> },
	];

	return (
		<div>
			<PageHeader
				title="Customers"
				count={customers.length}
			/>
			{customers.length === 0 ? (
				<EmptyState icon={Landmark} title="No customers yet" actionLabel="+ New customer" onAction={() => navigate("/customers/new")} />
			) : (
				<DataTable
					data={customers}
					columns={columns}
					getRowId={(c) => c.id}
					onRowClick={(c) => navigate(`/customers/${c.id}`)}
					searchPlaceholder="Search by name"
					searchFn={(c, q) => c.name.toLowerCase().includes(q)}
					toolbarRight={<Button onClick={() => navigate("/customers/new")}>+ New customer</Button>}
				/>
			)}
		</div>
	);
}
