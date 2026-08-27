import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Banner } from "@/components/shared/Banner";
import { FieldWrapper } from "@/components/shared/FieldWrapper";
import { FileUpload } from "@/components/shared/FileUpload";
import { SectionCard, SectionLabel } from "@/components/shared/SectionCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/store/useStore";
import type { Supplier } from "@/types";

const COUNTIES = ["Nakuru", "Uasin Gishu", "Trans Nzoia", "Kitale", "Bungoma"];

const BLANK: Omit<Supplier, "id" | "status" | "createdBy" | "approvedBy"> = {
	name: "", group: "", kraPin: "", idNo: "", county: "", address: "",
	etims: "", vat: "", aflatoxinLicence: false, bank: "", bankLetter: false,
	callbackDone: false, rail: "", transferBorneBy: "",
};

export default function SupplierDetailPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const isNew = id === "new";
	const existing = useStore((s) => (isNew ? undefined : s.suppliers.find((x) => x.id === id)));
	const createSupplier = useStore((s) => s.createSupplier);
	const updateSupplier = useStore((s) => s.updateSupplier);
	const submitSupplierForVerification = useStore((s) => s.submitSupplierForVerification);
	const approveSupplier = useStore((s) => s.approveSupplier);

	const [form, setForm] = useState<Omit<Supplier, "id" | "status" | "createdBy" | "approvedBy">>(
		existing ?? BLANK,
	);
	const [errors, setErrors] = useState<Record<string, string>>({});

	if (!isNew && !existing) {
		return <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Supplier not found.</div>;
	}

	const status = existing?.status ?? "Draft";
	const canApprove = status === "Verified" && existing?.createdBy !== "You (Purchase User)";

	function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
		setForm((f) => ({ ...f, [key]: value }));
	}

	function validate(): boolean {
		const next: Record<string, string> = {};
		if (!form.name) next.name = "Supplier name is required";
		if (!form.group) next.group = "Supplier group is required";
		setErrors(next);
		return Object.keys(next).length === 0;
	}

	function handleSave() {
		if (!validate()) {
			toast.error("Name and group are required");
			return;
		}
		if (isNew) {
			const created = createSupplier(form);
			toast.success("Supplier created as Draft");
			navigate(`/suppliers/${created.id}`);
		} else if (existing) {
			updateSupplier(existing.id, form);
			toast.success("Changes saved");
		}
	}

	function handleVerify() {
		if (!existing) return;
		updateSupplier(existing.id, form);
		const result = submitSupplierForVerification(existing.id);
		if (!result.ok) {
			toast.error(result.message ?? "Could not submit for verification");
			return;
		}
		toast.success("Submitted for verification");
	}

	function handleApprove() {
		if (!existing || !canApprove) return;
		approveSupplier(existing.id);
		toast.success("Supplier approved — can now transact");
	}

	return (
		<div>
			<div className="mb-4 flex items-start justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">{isNew ? "New supplier" : existing!.name}</h1>
					{!isNew && <p className="text-sm text-muted-foreground">{existing!.id}</p>}
				</div>
				{!isNew && <StatusBadge status={status} />}
			</div>

			{!isNew && status === "Draft" && (
				<div className="mb-4">
					<Banner type="warn">This supplier is in Draft. They cannot transact until Verified and Approved.</Banner>
				</div>
			)}
			{!isNew && status === "Verified" && (
				<div className="mb-4">
					<Banner type="info">Awaiting Finance approval. The person who created this record cannot approve it themselves.</Banner>
				</div>
			)}
			{!isNew && status === "Approved" && (
				<div className="mb-4">
					<Banner type="ok">Approved by {existing!.approvedBy}. This supplier can now transact.</Banner>
				</div>
			)}

			<SectionLabel>Basic details</SectionLabel>
			<SectionCard>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<FieldWrapper label="Supplier name" required error={errors.name}>
						<Input value={form.name} onChange={(e) => set("name", e.target.value)} />
					</FieldWrapper>
					<FieldWrapper label="Supplier group" required error={errors.group}>
						<Select value={form.group} onValueChange={(v) => set("group", v as Supplier["group"])}>
							<SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
							<SelectContent>
								{["Farmer", "Aggregator", "Trader", "Transporter"].map((o) => (
									<SelectItem key={o} value={o}>{o}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FieldWrapper>
					<FieldWrapper label="KRA PIN" required>
						<Input value={form.kraPin} onChange={(e) => set("kraPin", e.target.value)} />
					</FieldWrapper>
					<FieldWrapper label="KRA PIN certificate">
						<FileUpload />
					</FieldWrapper>
					<FieldWrapper label="Business reg / national ID">
						<Input value={form.idNo} onChange={(e) => set("idNo", e.target.value)} />
					</FieldWrapper>
					<FieldWrapper label="National ID / registration document">
						<FileUpload />
					</FieldWrapper>
					<FieldWrapper label="County">
						<Select value={form.county} onValueChange={(v) => set("county", v)}>
							<SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
							<SelectContent>
								{COUNTIES.map((o) => (
									<SelectItem key={o} value={o}>{o}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FieldWrapper>
					<FieldWrapper label="Physical address">
						<Input value={form.address} onChange={(e) => set("address", e.target.value)} />
					</FieldWrapper>
				</div>
			</SectionCard>

			<SectionLabel>Compliance</SectionLabel>
			<SectionCard>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<FieldWrapper label="eTIMS registration status">
						<Select value={form.etims} onValueChange={(v) => set("etims", v as Supplier["etims"])}>
							<SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
							<SelectContent>
								{["Registered", "Buyer-Generated", "Blocked"].map((o) => (
									<SelectItem key={o} value={o}>{o}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FieldWrapper>
					<FieldWrapper label="VAT status">
						<Select value={form.vat} onValueChange={(v) => set("vat", v as Supplier["vat"])}>
							<SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
							<SelectContent>
								{["Registered", "Not registered"].map((o) => (
									<SelectItem key={o} value={o}>{o}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FieldWrapper>
					<FieldWrapper label="Aflatoxin / food-safety licence on file" span>
						<div className="flex h-9 items-center gap-2">
							<Checkbox checked={form.aflatoxinLicence} onCheckedChange={(v) => set("aflatoxinLicence", v === true)} />
						</div>
					</FieldWrapper>
				</div>
			</SectionCard>

			<SectionLabel>Banking</SectionLabel>
			<SectionCard>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<FieldWrapper label="Bank details">
						<Input value={form.bank} onChange={(e) => set("bank", e.target.value)} placeholder="Bank — account number" />
					</FieldWrapper>
					<FieldWrapper label="Preferred payment rail">
						<Select value={form.rail} onValueChange={(v) => set("rail", v as Supplier["rail"])}>
							<SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
							<SelectContent>
								{["Mpesa", "PesaLink", "Bank Transfer", "Cash"].map((o) => (
									<SelectItem key={o} value={o}>{o}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FieldWrapper>
					<FieldWrapper label="Transfer charge borne by">
						<Select value={form.transferBorneBy} onValueChange={(v) => set("transferBorneBy", v as Supplier["transferBorneBy"])}>
							<SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
							<SelectContent>
								{["Supplier", "Us"].map((o) => (
									<SelectItem key={o} value={o}>{o}</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FieldWrapper>
					<FieldWrapper label="Bank letter attached">
						<div className="flex h-9 items-center gap-2">
							<Checkbox checked={form.bankLetter} onCheckedChange={(v) => set("bankLetter", v === true)} />
						</div>
					</FieldWrapper>
					<FieldWrapper label="First-payment call-back confirmed">
						<div className="flex h-9 items-center gap-2">
							<Checkbox checked={form.callbackDone} onCheckedChange={(v) => set("callbackDone", v === true)} />
						</div>
					</FieldWrapper>
				</div>
			</SectionCard>

			<div className="mt-6 flex flex-wrap items-center gap-2">
				<Button onClick={handleSave}>{isNew ? "Submit as Draft" : "Save changes"}</Button>
				{!isNew && status === "Draft" && <Button variant="outline" onClick={handleVerify}>Submit for verification</Button>}
				{!isNew && status === "Verified" && (
					<Button disabled={!canApprove} onClick={handleApprove}>Approve</Button>
				)}
				<Button variant="ghost" onClick={() => navigate("/suppliers")}>Cancel</Button>
			</div>
			{!isNew && status === "Verified" && !canApprove && (
				<p className="mt-2 text-xs text-muted-foreground">You created this record, so you cannot approve it. A different Finance user must.</p>
			)}
		</div>
	);
}
