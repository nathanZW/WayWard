import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { TrackInfo } from "../types/domain";
import { usePlaybackStore } from "../stores/usePlaybackStore";

export function useTauriPlaybackEvents(): void {
  useEffect(() => {
    const unlistenTrack = listen<TrackInfo>("smtc-update", (event) => {
      usePlaybackStore.getState().applyIncomingTrackInfo(event.payload);
    });
    const unlistenVisibility = listen<boolean>("window-visibility", (event) => {
      usePlaybackStore.getState().setWindowVisible(event.payload);
    });

    return () => {
      void unlistenTrack.then((dispose) => dispose());
      void unlistenVisibility.then((dispose) => dispose());
    };
  }, []);
}
