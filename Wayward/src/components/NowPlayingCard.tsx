import { memo, useMemo } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { formatTime, isNeutralTrack, normalizeTrackMetadata } from "../lib/track";
import { usePlaybackStore } from "../stores/usePlaybackStore";

/**
 * Isolated progress bar that subscribes only to position + duration.
 * This is the only part of the card that re-renders on every SMTC poll
 * tick (~1 Hz), keeping the heavier parent card (box-shadows, album art,
 * badges) stable between track changes.
 */
function ProgressTimeline() {
  const { position, duration } = usePlaybackStore(useShallow((state) => ({
    position: state.trackInfo.position,
    duration: state.trackInfo.duration
  })));

  const progressPercent = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <div className="progress-bar-container">
      <span>{formatTime(position)}</span>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
      </div>
      <span>{formatTime(duration)}</span>
    </div>
  );
}

const MemoizedProgressTimeline = memo(ProgressTimeline);

function NowPlayingCard() {
  const { title, artist, albumArtist, albumTitle, albumArt, status, duration } = usePlaybackStore(useShallow((state) => ({
    title: state.trackInfo.title,
    artist: state.trackInfo.artist,
    albumArtist: state.trackInfo.album_artist,
    albumTitle: state.trackInfo.album_title,
    albumArt: state.trackInfo.album_art,
    status: state.trackInfo.status,
    duration: state.trackInfo.duration
  })));

  const trackIdentity = { title, artist, album_artist: albumArtist, album_title: albumTitle, album_art: albumArt, duration };
  const idleState = isNeutralTrack(trackIdentity);
  const normalizedTrack = useMemo(() => normalizeTrackMetadata(trackIdentity), [
    title,
    artist,
    albumArtist,
    albumTitle
  ]);

  const trackTitle = idleState ? "Nothing playing" : title;
  const trackSubtitle = idleState
    ? "Waiting for a music stream"
    : [normalizedTrack.displayArtist || "Unknown artist", normalizedTrack.displayAlbum].filter(Boolean).join(" / ");
  const statusLabel = idleState ? "Ready" : status;

  return (
    <div className="now-playing-card">
      <div className="album-art">
        {albumArt ? (
          <img
            key={albumArt}
            src={albumArt}
            alt="Album art"
            className="album-art-inner album-art-image"
            decoding="async"
          />
        ) : (
          <div className="album-art-inner" />
        )}
      </div>
      <div className="track-info">
        <h2 className="track-title">{trackTitle}</h2>
        <p className="track-artist">{trackSubtitle}</p>
        <div className="track-meta">
          <div className="badges">
            <span className={`badge active ${idleState ? "idle" : ""}`}>{statusLabel}</span>
          </div>
          <MemoizedProgressTimeline />
        </div>
      </div>
      <div className="playback-controls">
        <button
          className="playback-control-btn"
          onClick={() => void invoke("skip_previous").catch((error) => console.error("Failed to skip previous:", error))}
          type="button"
        >
          <SkipBack size={18} fill="currentColor" />
        </button>
        <button
          className="play-pause-btn"
          onClick={() => void invoke("toggle_playback").catch((error) => console.error("Failed to toggle playback:", error))}
          type="button"
        >
          {status === "Playing"
            ? <Pause size={22} fill="currentColor" />
            : <Play size={22} fill="currentColor" />}
        </button>
        <button
          className="playback-control-btn"
          onClick={() => void invoke("skip_next").catch((error) => console.error("Failed to skip next:", error))}
          type="button"
        >
          <SkipForward size={18} fill="currentColor" />
        </button>
      </div>
    </div>
  );
}

export default memo(NowPlayingCard);
