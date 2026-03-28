import { create } from 'zustand';

type ModalKey = 'stats' | 'fairness' | 'help' | 'keyboard' | 'settings';

type UiState = {
  modals: Record<ModalKey, boolean>;
  open: (key: ModalKey) => void;
  set: (key: ModalKey, open: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  modals: {
    stats: false,
    fairness: false,
    help: false,
    keyboard: false,
    settings: false,
  },
  open: (key) => set((s) => ({ modals: { ...s.modals, [key]: true } })),
  set: (key, open) => set((s) => ({ modals: { ...s.modals, [key]: open } })),
}));
