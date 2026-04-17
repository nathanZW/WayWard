import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Check, Clipboard, Search } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useDeckModel } from "../hooks/useDeckModel";
import { copyDeckCard, searchDeckCard } from "../lib/deckCardActions";
import { usePlaybackStore } from "../stores/usePlaybackStore";
import { useUiStore } from "../stores/useUiStore";
import type { DeckCard, LaneMotionDirection, LaneTab } from "../types/domain";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function renderSwipeCard(
  card: DeckCard,
  tabClassName: string,
  role: "left" | "center" | "right",
  onCopy?: () => void,
  onSearch?: () => void,
  isCopied = false
) {
  const isPreview = role !== "center";

  return (
    <div
      className={`swipe-card ${tabClassName} ${role} ${isPreview ? "preview" : "center"}`}
      aria-hidden={isPreview}
    >
      {!isPreview && tabClassName !== "queue" && (
        <div className="swipe-card-actions">
          <button
            className={`swipe-card-copy-btn ${isCopied ? "is-copied" : ""}`}
            type="button"
            aria-label={isCopied ? "Copied" : "Copy active card"}
            title={isCopied ? "Copied" : "Copy active card"}
            onClick={(event) => {
              event.stopPropagation();
              onCopy?.();
            }}
          >
            <span className="swipe-card-copy-icon" aria-hidden="true">
              <Clipboard size={14} className="swipe-card-copy-icon-base" />
              <Check size={14} className="swipe-card-copy-icon-check" />
            </span>
          </button>
          <button
            className="swipe-card-search-btn"
            type="button"
            aria-label="Search active card"
            title="Search active card"
            onClick={(event) => {
              event.stopPropagation();
              onSearch?.();
            }}
          >
            <Search size={14} />
          </button>
        </div>
      )}
      <div className="album-art album-art-large">
        {card.imageSrc ? (
          <img
            src={card.imageSrc}
            alt=""
            className="album-art-inner album-art-image"
            decoding="async"
          />
        ) : (
          <div className="album-art-inner" />
        )}
      </div>
      <div className="swipe-card-content">
        <h3 className="swipe-card-title">{card.title}</h3>
        <p className="swipe-card-artist">{card.subtitle}</p>
        <div className="badges">
          {card.badges.map((badge, index) => (
            <span key={`${card.key}-${badge}-${index}`} className={`badge ${index === 0 ? "primary" : "secondary"}`}>
              {badge}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function DeckLane() {
  const deck = useDeckModel();
  const { sourcePlayer, windowVisible } = usePlaybackStore(useShallow((state) => ({
    sourcePlayer: state.trackInfo.source_player,
    windowVisible: state.windowVisible
  })));
  const { activeTab, copiedCardKey, laneMotion } = useUiStore(useShallow((state) => ({
    activeTab: state.activeTab,
    copiedCardKey: state.copiedCardKey,
    laneMotion: state.laneMotion
  })));
  const { setDiscoverCardIndex, setAlbumCardIndex, setLaneMotion, setCopiedCardKey } = useUiStore(useShallow((state) => ({
    setDiscoverCardIndex: state.setDiscoverCardIndex,
    setAlbumCardIndex: state.setAlbumCardIndex,
    setLaneMotion: state.setLaneMotion,
    setCopiedCardKey: state.setCopiedCardKey
  })));
  const laneMotionTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  useEffect(() => {
    setDiscoverCardIndex(0);
  }, [deck.discoverCardsKey, deck.lookupKey, setDiscoverCardIndex]);

  useEffect(() => {
    setAlbumCardIndex(0);
  }, [deck.albumCardsKey, deck.lookupKey, setAlbumCardIndex]);

  useEffect(() => {
    if (!windowVisible) return;

    const timeoutId = window.setTimeout(() => {
      const preloadUrls = new Set<string>();
      const activeIndex = deck.activeIndex;

      deck.activeCards.slice(activeIndex, activeIndex + 3).forEach((card) => {
        if (card?.imageSrc) preloadUrls.add(card.imageSrc);
      });
      deck.discoverCards.slice(0, 2).forEach((card) => {
        if (card.imageSrc) preloadUrls.add(card.imageSrc);
      });
      deck.albumCards.slice(0, 2).forEach((card) => {
        if (card.imageSrc) preloadUrls.add(card.imageSrc);
      });
      if (deck.leftPreviewCard?.imageSrc) preloadUrls.add(deck.leftPreviewCard.imageSrc);
      if (deck.rightPreviewCard?.imageSrc) preloadUrls.add(deck.rightPreviewCard.imageSrc);

      preloadUrls.forEach((url) => {
        const image = new Image();
        image.decoding = "async";
        image.src = url;
      });
    }, 150);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    deck.activeCards,
    deck.activeIndex,
    deck.albumCards,
    deck.discoverCards,
    deck.leftPreviewCard,
    deck.rightPreviewCard,
    windowVisible
  ]);

  useEffect(() => () => {
    if (laneMotionTimeoutRef.current !== null) {
      window.clearTimeout(laneMotionTimeoutRef.current);
    }

    if (copyFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
    }
  }, []);

  const triggerLaneMotion = useCallback((tab: LaneTab, direction: LaneMotionDirection) => {
    if (laneMotionTimeoutRef.current !== null) {
      window.clearTimeout(laneMotionTimeoutRef.current);
    }

    setLaneMotion({ tab, direction });
    laneMotionTimeoutRef.current = window.setTimeout(() => {
      setLaneMotion(null);
      laneMotionTimeoutRef.current = null;
    }, 280);
  }, [setLaneMotion]);

  const navigateLane = useCallback((tab: LaneTab, direction: -1 | 1) => {
    const motionDirection: LaneMotionDirection = direction === 1 ? "forward" : "backward";

    if (tab === "Discover") {
      const nextIndex = clamp(useUiStore.getState().discoverCardIndex + direction, 0, Math.max(deck.discoverCards.length - 1, 0));
      if (nextIndex === useUiStore.getState().discoverCardIndex) return;
      setDiscoverCardIndex(nextIndex);
      triggerLaneMotion(tab, motionDirection);
      return;
    }

    const nextIndex = clamp(useUiStore.getState().albumCardIndex + direction, 0, Math.max(deck.albumCards.length - 1, 0));
    if (nextIndex === useUiStore.getState().albumCardIndex) return;
    setAlbumCardIndex(nextIndex);
    triggerLaneMotion(tab, motionDirection);
  }, [deck.albumCards.length, deck.discoverCards.length, setAlbumCardIndex, setDiscoverCardIndex, triggerLaneMotion]);

  const copyActiveCard = useCallback(async () => {
    try {
      await copyDeckCard(deck.centerCard);
      setCopiedCardKey(deck.centerCard.key);

      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }

      copyFeedbackTimeoutRef.current = window.setTimeout(() => {
        setCopiedCardKey(null);
        copyFeedbackTimeoutRef.current = null;
      }, 2000);
    } catch (error) {
      console.error("Failed to copy active card:", error);
    }
  }, [deck.centerCard.key, deck.centerCard.subtitle, deck.centerCard.title, setCopiedCardKey]);

  const searchActiveCard = useCallback(async () => {
    try {
      await searchDeckCard(deck.centerCard, sourcePlayer);
    } catch (error) {
      console.error("Failed to search active card:", error);
    }
  }, [deck.centerCard, sourcePlayer]);

  const tabClassName = useMemo(() => activeTab.toLowerCase().replace(/\s+/g, "-"), [activeTab]);
  const laneMotionClass = laneMotion && laneMotion.tab === activeTab
    ? `lane-${laneMotion.direction}`
    : "";

  return (
    <div className="deck-container">
      <div className={`swipe-card-area ${deck.stackedLaneEnabled ? "stacked" : "single"}`}>
        <div className={`swipe-card-stack ${deck.stackedLaneEnabled ? "stacked" : "single"} ${laneMotionClass}`.trim()}>
          {deck.leftPreviewCard && (
            <div
              key={`left-${deck.leftPreviewCard.key}`}
              className="swipe-card-slot left"
              aria-hidden="true"
              onClick={() => navigateLane(activeTab as LaneTab, -1)}
            >
              {renderSwipeCard(deck.leftPreviewCard, tabClassName, "left")}
            </div>
          )}
          <div className="swipe-card-slot center">
            <div key={`${activeTab}-${deck.centerCard.key}`} className="swipe-card-stage center">
              {renderSwipeCard(
                deck.centerCard,
                tabClassName,
                "center",
                copyActiveCard,
                searchActiveCard,
                copiedCardKey === deck.centerCard.key
              )}
            </div>
          </div>
          {deck.rightPreviewCard && (
            <div
              key={`right-${deck.rightPreviewCard.key}`}
              className="swipe-card-slot right"
              aria-hidden="true"
              onClick={() => navigateLane(activeTab as LaneTab, 1)}
            >
              {renderSwipeCard(deck.rightPreviewCard, tabClassName, "right")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(DeckLane);
