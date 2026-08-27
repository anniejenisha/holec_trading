import {
	BarChart3,
	FileClock,
	FileText,
	Landmark,
	ScrollText,
	ShoppingCart,
	Truck,
	Users,
	Wallet,
	Wheat,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LotState } from "@/types";

export interface NavItem {
	path: string;
	label: string;
	icon: LucideIcon;
}

export interface NavGroup {
	label: string;
	items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
	{
		label: "Parties",
		items: [
			{ path: "/suppliers", label: "Suppliers", icon: Users },
			{ path: "/customers", label: "Customers", icon: Landmark },
		],
	},
	{
		label: "Trade",
		items: [
			{ path: "/lots", label: "Lots", icon: Wheat },
			{ path: "/tickets/new", label: "New ticket", icon: FileText },
			{ path: "/intake", label: "Intake & quality", icon: Truck },
			{ path: "/deductions", label: "Deductions & payable", icon: ScrollText },
			{ path: "/transport", label: "Transport & loss", icon: Truck },
			{ path: "/sales", label: "Sale & invoicing", icon: ShoppingCart },
		],
	},
	{
		label: "Finance",
		items: [{ path: "/payments", label: "Payments", icon: Wallet }],
	},
	{
		label: "Insight",
		items: [
			{ path: "/ledger", label: "Cost ledger & margin", icon: BarChart3 },
			{ path: "/reports", label: "Reports", icon: BarChart3 },
			{ path: "/event-log", label: "Trade event log", icon: FileClock },
		],
	},
];

export interface TimelineStage {
	label: string;
	state: LotState;
	route: string;
}

export const TIMELINE: TimelineStage[] = [
	{ label: "Ticket", state: "TICKET", route: "/tickets/new" },
	{ label: "Intake", state: "INTAKE", route: "/intake" },
	{ label: "Lot", state: "LOT", route: "/lots" },
	{ label: "Position", state: "POSITION", route: "/transport" },
	{ label: "Invoiced", state: "INVOICED", route: "/sales" },
	{ label: "Settled", state: "SETTLED", route: "/payments" },
];
