import { ChevronDown, Wheat } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { NAV_GROUPS } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function Sidebar() {
	const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

	return (
		<aside className="hidden w-60 shrink-0 flex-col border-r bg-card sm:flex">
			<div className="flex h-14 items-center gap-2 border-b px-4">
				<div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
					<Wheat className="size-4" />
				</div>
				<span className="text-sm font-semibold tracking-tight">Holec ERP</span>
			</div>

			<nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
				{NAV_GROUPS.map((group) => {
					const collapsed = collapsedGroups[group.label];
					return (
						<div key={group.label}>
							<button
								type="button"
								onClick={() => setCollapsedGroups((s) => ({ ...s, [group.label]: !s[group.label] }))}
								className="flex w-full items-center justify-between px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
							>
								{group.label}
								<ChevronDown className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")} />
							</button>
							{!collapsed && (
								<div className="mt-1 space-y-0.5">
									{group.items.map((item) => (
										<NavLink
											key={item.path}
											to={item.path}
											className={({ isActive }) =>
												cn(
													"flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
													isActive
														? "bg-primary/10 font-medium text-primary"
														: "text-foreground/80 hover:bg-accent hover:text-foreground",
												)
											}
										>
											<item.icon className="size-4 shrink-0" />
											{item.label}
										</NavLink>
									))}
								</div>
							)}
						</div>
					);
				})}
			</nav>
		</aside>
	);
}
