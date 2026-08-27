import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
	icon?: LucideIcon;
	title: string;
	description?: string;
	actionLabel?: string;
	onAction?: () => void;
}

export function EmptyState({ icon: Icon = Inbox, title, description, actionLabel, onAction }: EmptyStateProps) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-muted">
				<Icon className="size-6 text-muted-foreground" />
			</div>
			<div className="space-y-1">
				<p className="font-medium">{title}</p>
				{description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
			</div>
			{actionLabel && onAction && (
				<Button onClick={onAction} className="mt-2">
					{actionLabel}
				</Button>
			)}
		</div>
	);
}
