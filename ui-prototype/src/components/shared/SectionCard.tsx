import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SectionCardProps {
	title?: string;
	children: React.ReactNode;
}

export function SectionCard({ title, children }: SectionCardProps) {
	return (
		<Card>
			{title && (
				<CardHeader>
					<CardTitle className="text-base">{title}</CardTitle>
				</CardHeader>
			)}
			<CardContent>{children}</CardContent>
		</Card>
	);
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
	return <div className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">{children}</div>;
}
