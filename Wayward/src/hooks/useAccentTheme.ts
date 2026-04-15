import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { LruCache } from "../lib/cache";
import { buildAccentTheme, createThemeFromHex, extractColours, getThemeFallback, hexToRgb } from "../lib/theme";
import { isNeutralTrack } from "../lib/track";
import { usePlaybackStore } from "../stores/usePlaybackStore";
import type { ExtractedPalette } from "../types/domain";

const paletteCache = new LruCache<string, ExtractedPalette>(24);

export function useAccentTheme(): void {
  const { albumArt, idleState } = usePlaybackStore(useShallow((state) => ({
    albumArt: state.trackInfo.album_art,
    idleState: isNeutralTrack(state.trackInfo)
  })));

  useEffect(() => {
    let cancelled = false;
    const fallback = getThemeFallback(idleState);

    const applyTheme = (palette: ExtractedPalette | { primary: ReturnType<typeof hexToRgb>; secondary: ReturnType<typeof hexToRgb>; analysis: null }) => {
      if (cancelled) return;
      usePlaybackStore.getState().setAccentTheme(
        buildAccentTheme(palette.primary, palette.secondary, palette.analysis, idleState)
      );
    };

    if (!albumArt) {
      usePlaybackStore.getState().setAccentTheme(createThemeFromHex(fallback, idleState));
      return () => {
        cancelled = true;
      };
    }

    const cachedPalette = paletteCache.get(albumArt);
    if (cachedPalette) {
      applyTheme(cachedPalette);
      return () => {
        cancelled = true;
      };
    }

    extractColours(albumArt)
      .then((palette) => {
        paletteCache.set(albumArt, palette);
        applyTheme(palette);
      })
      .catch(() => applyTheme({
        primary: hexToRgb(fallback[0]),
        secondary: hexToRgb(fallback[1]),
        analysis: null
      }));

    return () => {
      cancelled = true;
    };
  }, [albumArt, idleState]);
}
