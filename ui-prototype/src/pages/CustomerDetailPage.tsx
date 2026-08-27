import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Banner } from "@/components/shared/Banner";
import { FieldWrapper } from "@/components/shared/FieldWrapper";
import { SectionCard, SectionLabel } from "@/components/shared/SectionCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/store/useStore";
import type { Customer } from "@/types";

const BLANK: Omit<Customer, "id" | "status" | "createdBy" | "approvedBy"> = {
	name: "", group: "", kraPin: "", address: "", creditLimit: 0, creditTerms: "",
	exposureLimit: 0, guarantee: "", moistureRule: "", fmRule: "", offloadingBorneBy: "",
};

export default function CustomerDetailPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const isNew = id === "new";
	const existing = useStore((s) => (isNew ? undefined : s.customers.find((x) => x.id === id)));
	const createCustomer = useStore((s) => s.createCustomer);
	const updateCustomer = useStore((s) => s.updateCustomer);
	const submitCustomerForVerification = useStore((s) => s.submitCustomerForVerification);
	const approveCustomer = useStore((s) => s.approveCustomer);

	const [form, setForm] = useState<Omit<Customer, "id" | "status" | "createdBy" | "approvedBy">>(existing ?? BLANK);
	const [errors, setErrors] = useState<Record<string, string>>({});

	if (!isNew && !existing) {
		return <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Customer not found.</div>;
	}

	const status = existing?.status ?? "Draft";

	function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
		setForm((f) => ({ ...f, [key]: value }));
	}

	function validate(): boolean {
		const next: Record<string, string> = {};
		if (!form.name) next.name = "Customer name is required";
		setErrors(next);
		return Object.keys(next).length === 0;
	}

	function handleSave() {
		if (!validate()) {
			toast.error("Name is required");
			return;
		}
		if (isNew) {
			const created = createCustomer(form);
			toast.success("Customer created as Draft");
			navigate(`/customers/${created.id}`);
		} else if (existing) {
			updateCustomer(existing.id, form);
			toast.success("Changes saved");
		}
	}

	function handleVerify() {
		if (!existing) return;
		updateCustomer(existing.id, form);
		submitCustomerForVerification(existing.id);
		toast.success("Submitted for verification");
	}

	function handleApprove() {
		if (!existing) return;
		approveCustomer(existing.id);
		toast.success("Customer approved — ready to invoice");
	}

	return (
		<div>
			<div className="mb-4 flex items-start justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">{isNew ? "New customer" : existing!.name}</h1>
					{!isNew && <p className="text-sm text-muted-foreground">{existing!.id}</p>}
				</div>
				{!isNew && <StatusBadge status={status} />}
			</div>

			{!isNew && status === "Draft" && <div className="mb-4"><Banner type="warn">This customer is in Draft and cannot be invoiced yet.</Banner></div>}
			{!isNew && status === "Approved" && <div className="mb-4"><Banner type="ok">Approved by {existing!.approvedBy}. Ready to invoice.</Banner></div>}

			<SectionLabel>Basic details</SectionLabel>
			<SectionCard>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<FieldWrapper label="Customer name" required error={errors.name}>
						<Input value={form.name} onChange={(e) => set("name", e.target.value)} />
					</FieldWrapper>
					<FieldWrapper label="Customer group">
						<Select value={form.group} onValueChange={(v) => set("group", v as Customer["group"])}>
							<SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
							<SelectContent>
								{["Miller", "Exporter", "Feed Manufacturer", "Trader"].map((o) => (
									<SelectItem key={o} value={o}>{o}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FieldWrapper>
					<FieldWrapper label="KRA PIN">
						<Input value={form.kraPin} onChange={(e) => set("kraPin", e.target.value)} />
					</FieldWrapper>
					<FieldWrapper label="Address">
						<Input value={form.address} onChange={(e) => set("address", e.target.value)} />
					</FieldWrapper>
				</div>
			</SectionCard>

			<SectionLabel>Commercial terms</SectionLabel>
			<SectionCard>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<FieldWrapper label="Credit limit (KES)">
						<Input type="number" value={form.creditLimit} onChange={(e) => set("creditLimit", Number(e.target.value) || 0)} />
					</FieldWrapper>
					<FieldWrapper label="Credit terms">
						<Select value={form.creditTerms} onValueChange={(v) => set("creditTerms", v as Customer["creditTerms"])}>
							<SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
							<SelectContent>
								{["Net 7", "Net 14", "Net 30", "Cash on delivery"].map((o) => (
									<SelectItem key={o} value={o}>{o}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FieldWrapper>
					<FieldWrapper label="Exposure limit (KES)">
						<Input type="number" value={form.exposureLimit} onChange={(e) => set("exposureLimit", Number(e.target.value) || 0)} />
					</FieldWrapper>
					<FieldWrapper label="Guarantee / security held" span>
						<Input value={form.guarantee} onChange={(e) => set("guarantee", e.target.value)} />
					</FieldWrapper>
				</div>
			</SectionCard>

			<SectionLabel>Quality profile</SectionLabel>
			<SectionCard>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<FieldWrapper label="Moisture rule">
						<Input value={form.moistureRule} onChange={(e) => set("moistureRule", e.target.value)} placeholder="e.g. 13.5% max" />
					</FieldWrapper>
					<FieldWrapper label="Foreign matter rule">
						<Input value={form.fmRule} onChange={(e) => set("fmRule", e.target.value)} placeholder="e.g. 2.0% max" />
					</FieldWrapper>
					<FieldWrapper label="Offloading borne by" span>
						<Select value={form.offloadingBorneBy} onValueChange={(v) => set("offloadingBorneBy", v as Customer["offloadingBorneBy"])}>
							<SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
							<SelectContent>
								{["Customer", "Us"].map((o) => (
									<SelectItem key={o} value={o}>{o}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FieldWrapper>
				</div>
			</SectionCard>

			<div className="mt-6 flex flex-wrap items-center gap-2">
				<Button onClick={handleSave}>{isNew ? "Submit as Draft" : "Save changes"}</Button>
				{!isNew && status === "Draft" && <Button variant="outline" onClick={handleVerify}>Submit for verification</Button>}
				{!isNew && status === "Verified" && <Button onClick={handleApprove}>Approve</Button>}
				<Button variant="ghost" onClick={() => navigate("/customers")}>Cancel</Button>
			</div>
		</div>
	);
}
