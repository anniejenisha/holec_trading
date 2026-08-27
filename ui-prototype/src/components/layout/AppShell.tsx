import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { TimelineStrip } from "@/components/layout/TimelineStrip";
import { Topbar } from "@/components/layout/Topbar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";

function InitialLoadSkeleton() {
	return (
		<div className="space-y-4 p-6">
			<Skeleton className="h-6 w-48" />
			<Skeleton className="h-4 w-96" />
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<Skeleton className="h-24" />
				<Skeleton className="h-24" />
				<Skeleton className="h-24" />
			</div>
			<Skeleton className="h-64 w-full" />
		</div>
	);
}

export function AppShell() {
	// Brief skeleton for polish even though data is instant/local.
	const [loading, setLoading] = useState(true);
	useEffect(() => {
		const t = setTimeout(() => setLoading(false), 350);
		return () => clearTimeout(t);
	}, []);

	const { pathname } = useLocation();
	const showTimeline = pathname.startsWith("/lots");

	return (
		<div className="flex h-screen overflow-hidden bg-background text-foreground">
			<Sidebar />
			<div className="flex min-w-0 flex-1 flex-col">
				<Topbar />
				{showTimeline && <TimelineStrip />}
				<main className="flex-1 overflow-y-auto">
					<div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{loading ? <InitialLoadSkeleton /> : <Outlet />}</div>
				</main>
			</div>
			<Toaster position="bottom-right" />
		</div>
	);
}
