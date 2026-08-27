import { useEffect } from "react";
import { useUiStore } from "@/store/useUiStore";

/** Registers a lot as "in context" for the timeline strip, clearing on unmount. */
export function useActiveLot(lotId: string | null | undefined) {
	const setActiveLotId = useUiStore((s) => s.setActiveLotId);
	useEffect(() => {
		setActiveLotId(lotId ?? null);
		return () => setActiveLotId(null);
	}, [lotId, setActiveLotId]);
}
