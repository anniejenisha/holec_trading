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
		{ key: "id", header: "Customer ID", render: (c) => <span className="font-mono text-xs font-semibold">{c.id}</span>, sortValue: (c) => c.id },
		{ key: "name", header: "Name", render: (c) => <span className="font-medium">{c.name}</span>, sortValue: (c) => c.name },
		{ key: "group", header: "Group", render: (c) => c.group || "—" },
		{
			key: "contact", header: "Primary Contact Area",
			render: (c) => {
				const primary = c.contacts?.find((ct) => ct.isPrimary) || c.contacts?.[0];
				return primary ? (
					<div className="text-xs">
						<span className="font-medium">{primary.name}</span>
						{primary.area && <span className="ml-1 text-muted-foreground">({primary.area})</span>}
					</div>
				) : "—";
			},
		},
		{
			key: "creditLimit", header: "Credit limit",
			render: (c) => (c.creditLimit ? fmtKES(c.creditLimit) : "—"),
			sortValue: (c) => c.creditLimit, className: "text-right",
		},
		{
			key: "status", header: "Status & Activation",
			render: (c) => (
				<div className="flex items-center gap-1.5">
					<StatusBadge status={c.status} />
					{c.status === "Approved" ? (
						<span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
							Active
						</span>
					) : (
						<span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
							Pending
						</span>
					)}
				</div>
			),
		},
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
