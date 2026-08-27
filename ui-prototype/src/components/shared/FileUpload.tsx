import { ScanLine, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Simulated capture-for-OCR upload — no real backend, just holds the filename for the prototype. */
export function FileUpload({ onFile }: { onFile?: (file: File | null) => void }) {
	const [fileName, setFileName] = useState<string | null>(null);
	const inputId = "upload-" + Math.random().toString(36).slice(2, 8);

	return (
		<div className="flex items-center gap-2">
			<input
				id={inputId}
				type="file"
				accept="image/*,application/pdf"
				className="hidden"
				onChange={(e) => {
					const f = e.target.files?.[0] ?? null;
					setFileName(f?.name ?? null);
					onFile?.(f);
				}}
			/>
			<Button type="button" variant="outline" size="sm" asChild>
				<label htmlFor={inputId} className="cursor-pointer">
					<Upload className="size-3.5" />
					{fileName ? "Replace" : "Upload"}
				</label>
			</Button>
			{fileName && (
				<span className="flex items-center gap-1 text-xs text-muted-foreground">
					<ScanLine className="size-3.5" /> {fileName}
				</span>
			)}
		</div>
	);
}
