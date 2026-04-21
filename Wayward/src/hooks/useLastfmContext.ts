import { useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { LruCache } from "../lib/cache";
import { buildLookupKey, isNeutralTrack, normalizeTrackMetadata } from "../lib/track";
import { usePlaybackStore } from "../stores/usePlaybackStore";
import type { LastfmContext } from "../types/domain";

const lastfmCache = new LruCache<string, LastfmContext>(50);
const LOOKUP_DEBOUNCE_MS = 200;

interface LastfmLookupRequest {
  generation: number;
  lookupKey: string;
  artist: string;
  track: string;
  albumTitle: string | null;
}

export function useLastfmContext(enabled = true): void {
  const lookupGenerationRef = useRef(0);
  const inFlightLookupRef = useRef(false);
  const activeLookupKeyRef = useRef<string | null>(null);
  const queuedLookupRef = useRef<LastfmLookupRequest | null>(null);
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
  const idleState = useMemo(() => isNeutralTrack(trackIdentity), [trackIdentity]);

  const runLookup = (request: LastfmLookupRequest): void => {
    inFlightLookupRef.current = true;
    activeLookupKeyRef.current = request.lookupKey;

    invoke<LastfmContext>("lookup_lastfm_context", {
      artist: request.artist,
      track: request.track,
      albumTitle: request.albumTitle
    })
      .then((result) => {
        if (request.generation !== lookupGenerationRef.current) {
          return;
        }

        lastfmCache.set(request.lookupKey, result);
        usePlaybackStore.getState().setLastfmState({
          lastfmContext: result,
          lastfmStatus: "ready",
          lastfmError: null
        });
      })
      .catch((error) => {
        if (request.generation !== lookupGenerationRef.current) {
          return;
        }

        usePlaybackStore.getState().setLastfmState({
          lastfmContext: null,
          lastfmStatus: "error",
          lastfmError: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        if (activeLookupKeyRef.current === request.lookupKey) {
          activeLookupKeyRef.current = null;
        }

        inFlightLookupRef.current = false;

        const queuedRequest = queuedLookupRef.current;
        queuedLookupRef.current = null;

        if (!queuedRequest || queuedRequest.generation !== lookupGenerationRef.current) {
          return;
        }

        const cachedQueuedLookup = lastfmCache.get(queuedRequest.lookupKey);
        if (cachedQueuedLookup) {
          usePlaybackStore.getState().setLastfmState({
            lastfmContext: cachedQueuedLookup,
            lastfmStatus: "ready",
            lastfmError: null
          });
          return;
        }

        runLookup(queuedRequest);
      });
  };

  useEffect(() => {
    const generation = lookupGenerationRef.current + 1;
    lookupGenerationRef.current = generation;
    queuedLookupRef.current = null;

    if (!enabled || idleState || !normalizedTrack.lookupTitle.trim() || !normalizedTrack.lookupArtist.trim()) {
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

    const request: LastfmLookupRequest = {
      generation,
      lookupKey,
      artist: normalizedTrack.lookupArtist,
      track: normalizedTrack.lookupTitle,
      albumTitle: normalizedTrack.displayAlbum || null
    };

    usePlaybackStore.getState().setLastfmState({
      lastfmContext: null,
      lastfmStatus: "loading",
      lastfmError: null
    });

    const timeoutId = window.setTimeout(() => {
      if (request.generation !== lookupGenerationRef.current) {
        return;
      }

      if (inFlightLookupRef.current) {
        if (activeLookupKeyRef.current !== request.lookupKey) {
          queuedLookupRef.current = request;
        }
        return;
      }

      runLookup(request);
    }, LOOKUP_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [enabled, idleState, lookupKey, normalizedTrack.displayAlbum, normalizedTrack.lookupArtist, normalizedTrack.lookupTitle]);
}
