import { memo, useMemo } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { formatTime, isNeutralTrack, normalizeTrackMetadata } from "../lib/track";
import { usePlaybackStore } from "../stores/usePlaybackStore";

function NowPlayingCard() {
  const trackInfo = usePlaybackStore((state) => state.trackInfo);
  const idleState = isNeutralTrack(trackInfo);
  const normalizedTrack = useMemo(() => normalizeTrackMetadata(trackInfo), [
    trackInfo.title,
    trackInfo.artist,
    trackInfo.album_artist,
    trackInfo.album_title
  ]);

  const progressPercent = trackInfo.duration > 0
    ? (trackInfo.position / trackInfo.duration) * 100
    : 0;
  const trackTitle = idleState ? "Nothing playing" : trackInfo.title;
  const trackSubtitle = idleState
    ? "Waiting for a music stream"
    : [normalizedTrack.displayArtist || "Unknown artist", normalizedTrack.displayAlbum].filter(Boolean).join(" / ");
  const statusLabel = idleState ? "Ready" : trackInfo.status;

  return (
    <div className="now-playing-card">
      <div className="album-art">
        {trackInfo.album_art ? (
          <img
            key={trackInfo.album_art}
            src={trackInfo.album_art}
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
          <div className="progress-bar-container">
            <span>{formatTime(trackInfo.position)}</span>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <span>{formatTime(trackInfo.duration)}</span>
          </div>
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
          {trackInfo.status === "Playing"
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
