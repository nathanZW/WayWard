import { create } from "zustand";
import type { AppTab, LaneMotionState } from "../types/domain";

interface UiState {
  activeTab: AppTab;
  discoverCardIndex: number;
  albumCardIndex: number;
  laneMotion: LaneMotionState | null;
  showShortcuts: boolean;
  copiedCardKey: string | null;
  setActiveTab: (activeTab: AppTab) => void;
  setDiscoverCardIndex: (discoverCardIndex: number) => void;
  setAlbumCardIndex: (albumCardIndex: number) => void;
  setLaneMotion: (laneMotion: LaneMotionState | null) => void;
  setShowShortcuts: (showShortcuts: boolean | ((current: boolean) => boolean)) => void;
  setCopiedCardKey: (copiedCardKey: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: "Discover",
  discoverCardIndex: 0,
  albumCardIndex: 0,
  laneMotion: null,
  showShortcuts: false,
  copiedCardKey: null,
  setActiveTab: (activeTab) => set({ activeTab }),
  setDiscoverCardIndex: (discoverCardIndex) => set({ discoverCardIndex }),
  setAlbumCardIndex: (albumCardIndex) => set({ albumCardIndex }),
  setLaneMotion: (laneMotion) => set({ laneMotion }),
  setShowShortcuts: (showShortcuts) => set((state) => ({
    showShortcuts: typeof showShortcuts === "function"
      ? showShortcuts(state.showShortcuts)
      : showShortcuts
  })),
  setCopiedCardKey: (copiedCardKey) => set({ copiedCardKey })
}));
