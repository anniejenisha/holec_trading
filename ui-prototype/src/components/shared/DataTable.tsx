import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/EmptyState";

export interface Column<T> {
	key: string;
	header: string;
	render: (row: T) => React.ReactNode;
	sortValue?: (row: T) => string | number;
	className?: string;
}

interface DataTableProps<T> {
	data: T[];
	columns: Column<T>[];
	getRowId: (row: T) => string;
	onRowClick?: (row: T) => void;
	searchPlaceholder?: string;
	searchFn?: (row: T, query: string) => boolean;
	emptyTitle?: string;
	emptyDescription?: string;
	toolbarRight?: React.ReactNode;
	pageSize?: number;
}

export function DataTable<T>({
	data,
	columns,
	getRowId,
	onRowClick,
	searchPlaceholder,
	searchFn,
	emptyTitle = "Nothing here yet",
	emptyDescription,
	toolbarRight,
	pageSize = 15,
}: DataTableProps<T>) {
	const [query, setQuery] = useState("");
	const [sortKey, setSortKey] = useState<string | null>(null);
	const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
	const [page, setPage] = useState(1);

	const filtered = useMemo(() => {
		if (!query || !searchFn) return data;
		return data.filter((row) => searchFn(row, query.toLowerCase()));
	}, [data, query, searchFn]);

	const sorted = useMemo(() => {
		if (!sortKey) return filtered;
		const col = columns.find((c) => c.key === sortKey);
		if (!col?.sortValue) return filtered;
		const copy = [...filtered];
		copy.sort((a, b) => {
			const av = col.sortValue!(a);
			const bv = col.sortValue!(b);
			const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
			return sortDir === "asc" ? cmp : -cmp;
		});
		return copy;
	}, [filtered, sortKey, sortDir, columns]);

	const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
	const clampedPage = Math.min(page, totalPages);
	const pageRows = sorted.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

	function toggleSort(key: string) {
		if (sortKey !== key) {
			setSortKey(key);
			setSortDir("asc");
		} else {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		}
	}

	return (
		<div className="space-y-3">
			{(searchFn || toolbarRight) && (
				<div className="flex items-center gap-2">
					{searchFn && (
						<Input
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								setPage(1);
							}}
							placeholder={searchPlaceholder ?? "Search…"}
							className="max-w-xs"
						/>
					)}
					<div className="flex-1" />
					{toolbarRight}
				</div>
			)}

			<div className="overflow-hidden rounded-lg border bg-card">
				{data.length === 0 ? (
					<div className="p-2">
						<EmptyState title={emptyTitle} description={emptyDescription} />
					</div>
				) : (
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow className="hover:bg-transparent">
									{columns.map((col) => (
										<TableHead key={col.key} className={col.className}>
											{col.sortValue ? (
												<button
													type="button"
													onClick={() => toggleSort(col.key)}
													className="flex items-center gap-1 hover:text-foreground"
												>
													{col.header}
													{sortKey === col.key ? (
														sortDir === "asc" ? (
															<ArrowUp className="size-3" />
														) : (
															<ArrowDown className="size-3" />
														)
													) : (
														<ArrowUpDown className="size-3 opacity-40" />
													)}
												</button>
											) : (
												col.header
											)}
										</TableHead>
									))}
								</TableRow>
							</TableHeader>
							<TableBody>
								{pageRows.map((row) => (
									<TableRow
										key={getRowId(row)}
										onClick={() => onRowClick?.(row)}
										className={onRowClick ? "cursor-pointer" : ""}
									>
										{columns.map((col) => (
											<TableCell key={col.key} className={col.className}>
												{col.render(row)}
											</TableCell>
										))}
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</div>

			{totalPages > 1 && (
				<div className="flex items-center justify-between text-sm text-muted-foreground">
					<span>
						Page {clampedPage} of {totalPages} · {sorted.length} rows
					</span>
					<div className="flex gap-1.5">
						<Button variant="outline" size="sm" disabled={clampedPage <= 1} onClick={() => setPage((p) => p - 1)}>
							Previous
						</Button>
						<Button variant="outline" size="sm" disabled={clampedPage >= totalPages} onClick={() => setPage((p) => p + 1)}>
							Next
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
