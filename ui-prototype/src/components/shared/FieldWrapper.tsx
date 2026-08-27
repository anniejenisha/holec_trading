import { cn } from "@/lib/utils";

interface FieldWrapperProps {
	label: string;
	htmlFor?: string;
	required?: boolean;
	error?: string;
	span?: boolean;
	children: React.ReactNode;
}

export function FieldWrapper({ label, htmlFor, required, error, span, children }: FieldWrapperProps) {
	return (
		<div className={cn("flex flex-col gap-1.5", span && "sm:col-span-2 lg:col-span-3")}>
			<label htmlFor={htmlFor} className="text-sm font-medium">
				{label}
				{required && <span className="ml-1 text-destructive">*</span>}
			</label>
			{children}
			{error && <span className="text-xs text-destructive">{error}</span>}
		</div>
	);
}
