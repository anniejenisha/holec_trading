import { AlertTriangle, Ban, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type BannerType = "warn" | "info" | "block" | "ok";

const CONFIG: Record<BannerType, { icon: typeof Info; className: string }> = {
	warn: { icon: AlertTriangle, className: "border-tier-configure/30 bg-tier-configure-bg text-tier-configure" },
	info: { icon: Info, className: "border-primary/20 bg-secondary text-secondary-foreground" },
	block: { icon: Ban, className: "border-destructive/30 bg-destructive/10 text-destructive" },
	ok: { icon: CheckCircle2, className: "border-tier-native/30 bg-tier-native-bg text-tier-native" },
};

export function Banner({ type, children }: { type: BannerType; children: React.ReactNode }) {
	const { icon: Icon, className } = CONFIG[type];
	return (
		<div className={cn("flex items-start gap-2.5 rounded-md border px-3.5 py-3 text-sm", className)}>
			<Icon className="mt-0.5 size-4 shrink-0" />
			<span>{children}</span>
		</div>
	);
}
