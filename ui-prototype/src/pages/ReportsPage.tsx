import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalcRow } from "@/components/shared/CalcRow";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { computePayable, computeSale } from "@/lib/calculations";
import { fmtKES, fmtKg } from "@/lib/format";
import { useStore } from "@/store/useStore";
import { STAGE_ORDER, type LotState } from "@/types";

const CHART_COLOR = "var(--color-primary)";

export default function ReportsPage() {
	const lots = useStore((s) => s.lots);
	const payments = useStore((s) => s.payments);

	const stateCounts = STAGE_ORDER.reduce<Record<LotState, number>>(
		(acc, s) => {
			acc[s] = lots.filter((l) => l.state === s).length;
			return acc;
		},
		{} as Record<LotState, number>,
	);
	const stateChartData = STAGE_ORDER.map((s) => ({
		stage: s.charAt(0) + s.slice(1).toLowerCase(),
		count: stateCounts[s],
	}));

	const totalPayable = lots.filter((l) => l.state !== "TICKET").reduce((sum, l) => sum + computePayable(l).netPayable, 0);
	const paidOut = payments.filter((p) => p.partyType === "Supplier").reduce((sum, p) => sum + p.amount, 0);
	const payablesDue = Math.max(0, totalPayable - paidOut);

	const invoicedLots = lots.filter((l) => l.state === "INVOICED");
	const receivablesDue = invoicedLots.reduce((sum, l) => sum + (computeSale(l)?.revenue ?? 0), 0);

	const cessByCounty: Record<string, number> = {};
	lots.filter((l) => l.county).forEach((l) => {
		cessByCounty[l.county!] = (cessByCounty[l.county!] ?? 0) + (l.cess ?? 0);
	});
	const cessChartData = Object.entries(cessByCounty).map(([county, amt]) => ({ county, amount: amt }));

	const stockByLot = lots.filter((l) => l.state === "LOT" || l.state === "POSITION");

	return (
		<div>
			<PageHeader title="Reports" />

			<SectionCard title="Open lots by state">
				<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
					<div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
						{STAGE_ORDER.map((s) => (
							<div key={s} className="text-center">
								<div className="text-xl font-semibold">{stateCounts[s]}</div>
								<div className="text-[11px] text-muted-foreground">{s.charAt(0) + s.slice(1).toLowerCase()}</div>
							</div>
						))}
					</div>
					<div className="h-40">
						<ResponsiveContainer width="100%" height="100%">
							<BarChart data={stateChartData}>
								<CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
								<XAxis dataKey="stage" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
								<YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={24} />
								<Tooltip cursor={{ fill: "var(--color-muted)" }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
								<Bar dataKey="count" fill={CHART_COLOR} radius={[4, 4, 0, 0]} />
							</BarChart>
						</ResponsiveContainer>
					</div>
				</div>
			</SectionCard>

			<div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
				<SectionCard title="Payables due">
					<CalcRow label="Total net payable" value={fmtKES(totalPayable)} />
					<CalcRow label="Already paid" value={`− ${fmtKES(paidOut)}`} neg />
					<CalcRow label="Outstanding" value={fmtKES(payablesDue)} total />
				</SectionCard>
				<SectionCard title="Receivables due">
					<CalcRow label="Invoiced, awaiting payment" value={fmtKES(receivablesDue)} total sub={`${invoicedLots.length} invoice(s)`} />
				</SectionCard>
			</div>

			<div className="mt-4">
				<SectionCard title="Stock on hand by lot">
					{stockByLot.length ? (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Ticket</TableHead>
									<TableHead>Location</TableHead>
									<TableHead className="text-right">Quantity</TableHead>
									<TableHead>State</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{stockByLot.map((l) => (
									<TableRow key={l.id}>
										<TableCell className="font-mono text-xs">{l.ticketNo}</TableCell>
										<TableCell>{l.county}, {l.area}</TableCell>
										<TableCell className="text-right">{fmtKg(computePayable(l).acceptedNetKg)}</TableCell>
										<TableCell><StatusBadge status={l.state} /></TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					) : (
						<EmptyState title="No stock currently held." />
					)}
				</SectionCard>
			</div>

			<div className="mt-4">
				<SectionCard title="Cess by county">
					{cessChartData.length ? (
						<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
							<div>{cessChartData.map(({ county, amount }) => <CalcRow key={county} label={county} value={fmtKES(amount)} />)}</div>
							<div className="h-40">
								<ResponsiveContainer width="100%" height="100%">
									<BarChart data={cessChartData} layout="vertical">
										<CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
										<XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
										<YAxis type="category" dataKey="county" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
										<Tooltip cursor={{ fill: "var(--color-muted)" }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
										<Bar dataKey="amount" fill={CHART_COLOR} radius={[0, 4, 4, 0]} />
									</BarChart>
								</ResponsiveContainer>
							</div>
						</div>
					) : (
						<EmptyState title="No cess posted yet." />
					)}
				</SectionCard>
			</div>
		</div>
	);
}
