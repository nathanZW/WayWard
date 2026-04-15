import { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { LruCache } from "../lib/cache";
import { buildLookupKey, isNeutralTrack, normalizeTrackMetadata } from "../lib/track";
import { usePlaybackStore } from "../stores/usePlaybackStore";
import type { LastfmContext } from "../types/domain";

const lastfmCache = new LruCache<string, LastfmContext>(50);

export function useLastfmContext(): void {
  const trackIdentity = usePlaybackStore(useShallow((state) => ({
    title: state.trackInfo.title,
    artist: state.trackInfo.artist,
    album_artist: state.trackInfo.album_artist,
    album_title: state.trackInfo.album_title,
    album_art: state.trackInfo.album_art,
    duration: state.trackInfo.duration
  })));

  const normalizedTrack = useMemo(() => normalizeTrackMetadata(trackIdentity), [
    trackIdentity.title,
    trackIdentity.artist,
    trackIdentity.album_artist,
    trackIdentity.album_title
  ]);
  const lookupKey = useMemo(() => buildLookupKey(normalizedTrack), [normalizedTrack]);
  const idleState = useMemo(() => isNeutralTrack({
    ...trackIdentity,
    position: 0,
    status: "Idle"
  }), [trackIdentity]);

  useEffect(() => {
    if (idleState || !normalizedTrack.lookupTitle.trim() || !normalizedTrack.lookupArtist.trim()) {
      usePlaybackStore.getState().setLastfmState({
        lastfmContext: null,
        lastfmStatus: "idle",
        lastfmError: null
      });
      return;
    }

    const cached = lastfmCache.get(lookupKey);
    if (cached) {
      usePlaybackStore.getState().setLastfmState({
        lastfmContext: cached,
        lastfmStatus: "ready",
        lastfmError: null
      });
      return;
    }

    let cancelled = false;
    usePlaybackStore.getState().setLastfmState({
      lastfmContext: null,
      lastfmStatus: "loading",
      lastfmError: null
    });

    invoke<LastfmContext>("lookup_lastfm_context", {
      artist: normalizedTrack.lookupArtist,
      track: normalizedTrack.lookupTitle,
      albumTitle: normalizedTrack.displayAlbum || null
    })
      .then((result) => {
        if (cancelled) return;
        lastfmCache.set(lookupKey, result);
        usePlaybackStore.getState().setLastfmState({
          lastfmContext: result,
          lastfmStatus: "ready",
          lastfmError: null
        });
      })
      .catch((error) => {
        if (cancelled) return;
        usePlaybackStore.getState().setLastfmState({
          lastfmContext: null,
          lastfmStatus: "error",
          lastfmError: error instanceof Error ? error.message : String(error)
        });
      });

    return () => {
      cancelled = true;
    };
  }, [idleState, lookupKey, normalizedTrack.displayAlbum, normalizedTrack.lookupArtist, normalizedTrack.lookupTitle]);
}
