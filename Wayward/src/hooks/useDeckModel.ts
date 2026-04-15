import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { buildDeckModel } from "../lib/track";
import { usePlaybackStore } from "../stores/usePlaybackStore";
import { useUiStore } from "../stores/useUiStore";

export function useDeckModel() {
  const playback = usePlaybackStore(useShallow((state) => ({
    title: state.trackInfo.title,
    artist: state.trackInfo.artist,
    album_artist: state.trackInfo.album_artist,
    album_title: state.trackInfo.album_title,
    album_art: state.trackInfo.album_art,
    duration: state.trackInfo.duration,
    lastfmContext: state.lastfmContext,
    lastfmStatus: state.lastfmStatus,
    mood: state.accentTheme.mood
  })));
  const ui = useUiStore(useShallow((state) => ({
    activeTab: state.activeTab,
    discoverCardIndex: state.discoverCardIndex,
    albumCardIndex: state.albumCardIndex
  })));

  return useMemo(() => buildDeckModel({
    trackInfo: {
      title: playback.title,
      artist: playback.artist,
      album_artist: playback.album_artist,
      album_title: playback.album_title,
      album_art: playback.album_art,
      duration: playback.duration
    },
    lastfmContext: playback.lastfmContext,
    lastfmStatus: playback.lastfmStatus,
    activeTab: ui.activeTab,
    discoverCardIndex: ui.discoverCardIndex,
    albumCardIndex: ui.albumCardIndex,
    mood: playback.mood
  }), [
    playback.title,
    playback.artist,
    playback.album_artist,
    playback.album_title,
    playback.album_art,
    playback.duration,
    playback.lastfmContext,
    playback.lastfmStatus,
    playback.mood,
    ui.activeTab,
    ui.discoverCardIndex,
    ui.albumCardIndex
  ]);
}
