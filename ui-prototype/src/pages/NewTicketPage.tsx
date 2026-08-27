import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Banner } from "@/components/shared/Banner";
import { FieldWrapper } from "@/components/shared/FieldWrapper";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayISO } from "@/lib/format";
import { useStore } from "@/store/useStore";

export default function NewTicketPage() {
	const navigate = useNavigate();
	const suppliers = useStore((s) => s.suppliers);
	const createTicket = useStore((s) => s.createTicket);

	const approvedSuppliers = suppliers.filter((s) => s.status === "Approved");
	const unapprovedCount = suppliers.length - approvedSuppliers.length;

	const [supplierId, setSupplierId] = useState("");
	const [item, setItem] = useState("Maize");
	const [qty, setQty] = useState("");
	const [date, setDate] = useState(todayISO());
	const [errors, setErrors] = useState<Record<string, string>>({});

	function handleCreate() {
		const next: Record<string, string> = {};
		if (!supplierId) next.supplierId = "Select a supplier";
		const qtyNum = Number(qty);
		if (!qtyNum || qtyNum <= 0) next.qty = "Enter an expected quantity";
		setErrors(next);
		if (Object.keys(next).length > 0) {
			toast.error(Object.values(next)[0]);
			return;
		}
		const lot = createTicket({ supplierId, item, qty: qtyNum });
		toast.success(`Ticket ${lot.ticketNo} created`);
		navigate(`/lots/${lot.id}`);
	}

	return (
		<div>
			<PageHeader title="New ticket" />

			{unapprovedCount > 0 && (
				<div className="mb-4">
					<Banner type="info">
						{unapprovedCount} supplier(s) are not yet Approved and won't appear below — check Suppliers to move them forward.
					</Banner>
				</div>
			)}

			<SectionCard title="Ticket details">
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<FieldWrapper label="Supplier" required error={errors.supplierId}>
						<Select value={supplierId} onValueChange={setSupplierId}>
							<SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
							<SelectContent>
								{approvedSuppliers.map((s) => (
									<SelectItem key={s.id} value={s.id}>{s.name} ({s.group})</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FieldWrapper>
					<FieldWrapper label="Item">
						<Select value={item} onValueChange={setItem}>
							<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
							<SelectContent>
								<SelectItem value="Maize">Maize</SelectItem>
								<SelectItem value="Beans">Beans</SelectItem>
							</SelectContent>
						</Select>
					</FieldWrapper>
					<FieldWrapper label="Expected quantity (kg)" required error={errors.qty}>
						<Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 8000" />
					</FieldWrapper>
					<FieldWrapper label="Expected delivery date">
						<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
					</FieldWrapper>
				</div>
			</SectionCard>

			<div className="mt-6 flex items-center gap-2">
				<Button onClick={handleCreate}>Create ticket</Button>
				<Button variant="ghost" onClick={() => navigate("/lots")}>Cancel</Button>
			</div>
		</div>
	);
}
