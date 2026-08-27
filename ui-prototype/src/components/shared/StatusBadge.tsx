import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
	// party workflow
	Draft: "bg-muted text-muted-foreground",
	Verified: "bg-tier-configure-bg text-tier-configure",
	Approved: "bg-tier-native-bg text-tier-native",
	// lot lifecycle
	TICKET: "bg-muted text-muted-foreground",
	INTAKE: "bg-tier-configure-bg text-tier-configure",
	LOT: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
	POSITION: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
	INVOICED: "bg-tier-configure-bg text-tier-configure",
	SETTLED: "bg-tier-native-bg text-tier-native",
	// payments
	Completed: "bg-tier-native-bg text-tier-native",
	Pending: "bg-tier-configure-bg text-tier-configure",
	Failed: "bg-tier-build-bg text-tier-build",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
	return (
		<Badge variant="secondary" className={cn("gap-1.5 font-normal", TONE[status] ?? "bg-muted text-muted-foreground", className)}>
			<span className="size-1.5 rounded-full bg-current" />
			{status.charAt(0) + status.slice(1).toLowerCase()}
		</Badge>
	);
}
