import { create } from "zustand";
import { createThemeFromHex } from "../lib/theme";
import { NEUTRAL_ACCENT, NEUTRAL_TRACK, type AccentTheme, type LastfmContext, type LastfmStatus, type TrackInfo } from "../types/domain";
import { isNeutralTrack } from "../lib/track";

interface PlaybackState {
  trackInfo: TrackInfo;
  windowVisible: boolean;
  accentTheme: AccentTheme;
  lastfmContext: LastfmContext | null;
  lastfmStatus: LastfmStatus;
  lastfmError: string | null;
  applyIncomingTrackInfo: (trackInfo: TrackInfo) => void;
  setWindowVisible: (windowVisible: boolean) => void;
  setAccentTheme: (accentTheme: AccentTheme) => void;
  setLastfmState: (state: Pick<PlaybackState, "lastfmContext" | "lastfmStatus" | "lastfmError">) => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  trackInfo: NEUTRAL_TRACK,
  windowVisible: true,
  accentTheme: createThemeFromHex(NEUTRAL_ACCENT, true),
  lastfmContext: null,
  lastfmStatus: "idle",
  lastfmError: null,
  applyIncomingTrackInfo: (trackInfo) => set((state) => {
    if (
      !isNeutralTrack(trackInfo)
      && !trackInfo.album_art
      && state.trackInfo.album_art
      && trackInfo.title === state.trackInfo.title
      && trackInfo.artist === state.trackInfo.artist
      && trackInfo.album_title === state.trackInfo.album_title
    ) {
      return { trackInfo: { ...trackInfo, album_art: state.trackInfo.album_art } };
    }

    return { trackInfo };
  }),
  setWindowVisible: (windowVisible) => set({ windowVisible }),
  setAccentTheme: (accentTheme) => set({ accentTheme }),
  setLastfmState: ({ lastfmContext, lastfmStatus, lastfmError }) => set({
    lastfmContext,
    lastfmStatus,
    lastfmError
  })
}));
