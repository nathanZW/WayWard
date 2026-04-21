import { useEffect, useEffectEvent, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { copyDeckCard, searchDeckCard } from "../lib/deckCardActions";
import { buildDeckModel } from "../lib/track";
import { usePlaybackStore } from "../stores/usePlaybackStore";
import { useUiStore } from "../stores/useUiStore";
import type { LaneMotionDirection, LaneTab } from "../types/domain";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isEditableElement(element: Element | null): boolean {
  return element instanceof HTMLElement
    && (element.tagName === "INPUT"
      || element.tagName === "TEXTAREA"
      || element.tagName === "SELECT"
      || element.isContentEditable);
}

export function useKeyboardShortcuts(enabled = true): void {
  const laneMotionTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const triggerLaneMotion = useEffectEvent((tab: LaneTab, direction: LaneMotionDirection) => {
    if (laneMotionTimeoutRef.current !== null) {
      window.clearTimeout(laneMotionTimeoutRef.current);
    }

    useUiStore.getState().setLaneMotion({ tab, direction });
    laneMotionTimeoutRef.current = window.setTimeout(() => {
      useUiStore.getState().setLaneMotion(null);
      laneMotionTimeoutRef.current = null;
    }, 280);
  });

  const copyActiveCard = useEffectEvent(async () => {
    const playbackState = usePlaybackStore.getState();
    const uiState = useUiStore.getState();
    const deck = buildDeckModel({
      trackInfo: {
        title: playbackState.trackInfo.title,
        artist: playbackState.trackInfo.artist,
        album_artist: playbackState.trackInfo.album_artist,
        album_title: playbackState.trackInfo.album_title,
        album_art: playbackState.trackInfo.album_art,
        duration: playbackState.trackInfo.duration
      },
      lastfmContext: playbackState.lastfmContext,
      lastfmStatus: playbackState.lastfmStatus,
      activeTab: uiState.activeTab,
      discoverCardIndex: uiState.discoverCardIndex,
      albumCardIndex: uiState.albumCardIndex,
      mood: playbackState.accentTheme.mood
    });
    const targetCard = deck.centerCard;
    if (!targetCard) return;

    try {
      await copyDeckCard(targetCard);
      useUiStore.getState().setCopiedCardKey(targetCard.key);

      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }

      copyFeedbackTimeoutRef.current = window.setTimeout(() => {
        useUiStore.getState().setCopiedCardKey(null);
        copyFeedbackTimeoutRef.current = null;
      }, 2000);
    } catch (error) {
      console.error("Failed to copy active card:", error);
    }
  });

  const searchActiveCard = useEffectEvent(async () => {
    const playbackState = usePlaybackStore.getState();
    const uiState = useUiStore.getState();
    if (uiState.activeTab === "Queue") return;

    const deck = buildDeckModel({
      trackInfo: {
        title: playbackState.trackInfo.title,
        artist: playbackState.trackInfo.artist,
        album_artist: playbackState.trackInfo.album_artist,
        album_title: playbackState.trackInfo.album_title,
        album_art: playbackState.trackInfo.album_art,
        duration: playbackState.trackInfo.duration
      },
      lastfmContext: playbackState.lastfmContext,
      lastfmStatus: playbackState.lastfmStatus,
      activeTab: uiState.activeTab,
      discoverCardIndex: uiState.discoverCardIndex,
      albumCardIndex: uiState.albumCardIndex,
      mood: playbackState.accentTheme.mood
    });
    const targetCard = deck.centerCard;
    if (!targetCard) return;

    try {
      await searchDeckCard(targetCard, playbackState.trackInfo.source_player);
    } catch (error) {
      console.error("Failed to search active card:", error);
    }
  });

  const onKeyDown = useEffectEvent(async (event: KeyboardEvent) => {
    const lowerKey = event.key.toLowerCase();
    const typingInEditable = isEditableElement(document.activeElement);

    if (event.key === "Escape") {
      if (typingInEditable) {
        event.preventDefault();
        useUiStore.getState().setShowShortcuts(false);
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        return;
      }

      useUiStore.getState().setShowShortcuts(false);
      usePlaybackStore.getState().setWindowVisible(false);
      await getCurrentWindow().hide();
      return;
    }

    if (typingInEditable) {
      return;
    }

    const uiState = useUiStore.getState();
    const playbackState = usePlaybackStore.getState();
    const deck = buildDeckModel({
      trackInfo: {
        title: playbackState.trackInfo.title,
        artist: playbackState.trackInfo.artist,
        album_artist: playbackState.trackInfo.album_artist,
        album_title: playbackState.trackInfo.album_title,
        album_art: playbackState.trackInfo.album_art,
        duration: playbackState.trackInfo.duration
      },
      lastfmContext: playbackState.lastfmContext,
      lastfmStatus: playbackState.lastfmStatus,
      activeTab: uiState.activeTab,
      discoverCardIndex: uiState.discoverCardIndex,
      albumCardIndex: uiState.albumCardIndex,
      mood: playbackState.accentTheme.mood
    });

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      void invoke("skip_previous").catch((error) => {
        console.error("Failed to skip previous:", error);
      });
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      void invoke("skip_next").catch((error) => {
        console.error("Failed to skip next:", error);
      });
    }

    if (event.key === " " && !event.shiftKey && document.activeElement?.tagName !== "INPUT") {
      event.preventDefault();
      void invoke("toggle_playback").catch((error) => {
        console.error("Failed to toggle playback:", error);
      });
    }

    if (!typingInEditable && !event.ctrlKey && !event.metaKey && !event.altKey && lowerKey === "o") {
      event.preventDefault();
      useUiStore.getState().setShowShortcuts((current) => !current);
    }

    if (!typingInEditable && !event.ctrlKey && !event.metaKey && !event.altKey && (lowerKey === "j" || lowerKey === "l")) {
      if (uiState.activeTab === "Discover" && deck.discoverCards.length > 1) {
        event.preventDefault();
        const direction = lowerKey === "j" ? -1 : 1;
        const nextIndex = clamp(uiState.discoverCardIndex + direction, 0, Math.max(deck.discoverCards.length - 1, 0));
        if (nextIndex !== uiState.discoverCardIndex) {
          useUiStore.getState().setDiscoverCardIndex(nextIndex);
          triggerLaneMotion("Discover", direction === 1 ? "forward" : "backward");
        }
      }

      if (uiState.activeTab === "Similar albums" && deck.albumCards.length > 1) {
        event.preventDefault();
        const direction = lowerKey === "j" ? -1 : 1;
        const nextIndex = clamp(uiState.albumCardIndex + direction, 0, Math.max(deck.albumCards.length - 1, 0));
        if (nextIndex !== uiState.albumCardIndex) {
          useUiStore.getState().setAlbumCardIndex(nextIndex);
          triggerLaneMotion("Similar albums", direction === 1 ? "forward" : "backward");
        }
      }
    }

    if (event.key === "1") {
      event.preventDefault();
      useUiStore.getState().setActiveTab("Discover");
    }

    if (event.key === "2") {
      event.preventDefault();
      useUiStore.getState().setActiveTab("Similar albums");
    }

    if (!typingInEditable && !event.ctrlKey && !event.metaKey && !event.altKey && lowerKey === "c") {
      event.preventDefault();
      void copyActiveCard();
    }

    if (!typingInEditable && !event.ctrlKey && !event.metaKey && !event.altKey && lowerKey === "s") {
      event.preventDefault();
      void searchActiveCard();
    }
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      void onKeyDown(event);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);

      if (laneMotionTimeoutRef.current !== null) {
        window.clearTimeout(laneMotionTimeoutRef.current);
      }

      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, [enabled, onKeyDown]);
}
