// Website or admin panel made by Clovic.
'use client';

import { create } from 'zustand';

type PanelState = {
  activeSection: 'main' | 'developer';
  setActiveSection: (section: PanelState['activeSection']) => void;
};

export const usePanelStore = create<PanelState>((set) => ({
  activeSection: 'main',
  setActiveSection: (activeSection) => set({ activeSection }),
}));
