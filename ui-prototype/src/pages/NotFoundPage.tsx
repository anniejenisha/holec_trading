import { FileQuestion } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "@/components/shared/EmptyState";

export default function NotFoundPage() {
	const navigate = useNavigate();
	return (
		<EmptyState
			icon={FileQuestion}
			title="Page not found"
			actionLabel="Back to Lots"
			onAction={() => navigate("/lots")}
		/>
	);
}
