import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGE_ORDER, type LotState } from "@/types";

const LABELS = STAGE_ORDER.map((s) => s.charAt(0) + s.slice(1).toLowerCase());

export function ProgressTrack({ currentState }: { currentState: LotState }) {
	const idx = STAGE_ORDER.indexOf(currentState);

	return (
		<div className="flex items-center overflow-x-auto py-4">
			{LABELS.map((label, i) => {
				const done = i < idx;
				const current = i === idx;
				return (
					<div key={label} className="flex items-center">
						{i > 0 && <div className={cn("h-px w-8 shrink-0 sm:w-14", i <= idx ? "bg-primary" : "bg-border")} />}
						<div className="flex shrink-0 flex-col items-center gap-1.5 px-1">
							<div
								className={cn(
									"flex size-7 items-center justify-center rounded-full border text-xs font-medium transition-colors",
									done && "border-primary bg-primary text-primary-foreground",
									current && "border-primary bg-primary/10 text-primary ring-4 ring-primary/10",
									!done && !current && "border-border bg-background text-muted-foreground",
								)}
							>
								{done ? <Check className="size-3.5" /> : i + 1}
							</div>
							<span className={cn("whitespace-nowrap text-[11px]", current ? "font-medium text-foreground" : "text-muted-foreground")}>
								{label}
							</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}
