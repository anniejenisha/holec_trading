import { cn } from "@/lib/utils";

interface CalcRowProps {
	label: string;
	value: string;
	sub?: string;
	neg?: boolean;
	total?: boolean;
}

export function CalcRow({ label, value, sub, neg, total }: CalcRowProps) {
	return (
		<div className={cn("flex items-center justify-between gap-4 py-2.5", total && "border-t pt-3 font-medium")}>
			<div>
				<div className="text-sm">{label}</div>
				{sub && <div className="text-xs text-muted-foreground">{sub}</div>}
			</div>
			<div className={cn("shrink-0 font-mono text-sm tabular-nums", neg && "text-destructive", total && "text-base font-semibold")}>
				{value}
			</div>
		</div>
	);
}
