// Tracks which Lot is currently "in context" (its detail page, or any of the
// per-lot action screens: intake/deductions/transport/sales/payments).
// The persistent timeline strip reads this to highlight the LOT'S actual
// stage rather than the page route — fixing the bug from the HTML prototype
// where the timeline showed whatever module you were on, not the lot's state.

import { create } from "zustand";

interface UiState {
	activeLotId: string | null;
	setActiveLotId: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
	activeLotId: null,
	setActiveLotId: (id) => set({ activeLotId: id }),
}));
