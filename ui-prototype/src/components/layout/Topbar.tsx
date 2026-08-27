import { ChevronRight, LogOut, Settings } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NAV_GROUPS } from "@/lib/nav";

function useBreadcrumb() {
	const { pathname } = useLocation();
	for (const group of NAV_GROUPS) {
		for (const item of group.items) {
			if (pathname === item.path || pathname.startsWith(item.path + "/")) {
				return { group: group.label, label: item.label };
			}
		}
	}
	return { group: "Holec ERP", label: "Overview" };
}

export function Topbar() {
	const crumb = useBreadcrumb();

	return (
		<header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 sm:px-6">
			<div className="flex items-center gap-1.5 text-sm">
				<span className="text-muted-foreground">Holec Trading</span>
				<ChevronRight className="size-3.5 text-muted-foreground/50" />
				<span className="text-muted-foreground">{crumb.group}</span>
				<ChevronRight className="size-3.5 text-muted-foreground/50" />
				<span className="font-medium">{crumb.label}</span>
			</div>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button type="button" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
						<Avatar className="size-7">
							<AvatarFallback className="bg-primary text-[11px] text-primary-foreground">YU</AvatarFallback>
						</Avatar>
						<div className="hidden text-left sm:block">
							<div className="text-xs font-medium leading-tight">You</div>
							<div className="text-[10px] leading-tight text-muted-foreground">Purchase User</div>
						</div>
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-48">
					<DropdownMenuLabel>You · Purchase User</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem disabled>
						<Settings className="size-4" />
						Settings
					</DropdownMenuItem>
					<DropdownMenuItem disabled>
						<LogOut className="size-4" />
						Log out
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</header>
	);
}
