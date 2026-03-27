import { useEffect, useState, useRef, useCallback } from "react";
import { Search, Pause, Play, PlusCircle, Settings, X, SkipBack, SkipForward } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface TrackInfo {
  title: string;
  artist: string;
  album_artist: string;
  album_title: string;
  status: string;
  position: number;
  duration: number;
  album_art: string | null;
}

function formatTime(secs: number): string {
  if (secs <= 0 || !isFinite(secs)) return "0:00";
  const totalSeconds = Math.round(secs);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function App() {
  const [activeTab, setActiveTab] = useState("Discover");
  const [trackInfo, setTrackInfo] = useState<TrackInfo>({
    title: "Midnight Rain",
    artist: "Taylor Swift",
    album_artist: "",
    album_title: "Midnights",
    status: "Playing",
    position: 83,
    duration: 214,
    album_art: null
  });
  const [showShortcuts, setShowShortcuts] = useState(false);
  const shortcutsRef = useRef<HTMLDivElement>(null);

  const handlePlayPause = useCallback(async () => {
    try {
      await invoke("toggle_playback");
    } catch (e) {
      console.error("Failed to toggle playback:", e);
    }
  }, []);

  const handleSkipNext = useCallback(async () => {
    try {
      await invoke("skip_next");
    } catch (e) {
      console.error("Failed to skip next:", e);
    }
  }, []);

  const handleSkipPrevious = useCallback(async () => {
    try {
      await invoke("skip_previous");
    } catch (e) {
      console.error("Failed to skip previous:", e);
    }
  }, []);

  // Minimal frontend global shortcut hook for the view
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowShortcuts(false);
        await getCurrentWindow().hide();
      }

      // Action callbacks (to be implemented with backend)
      if (e.key === "ArrowLeft" || (e.ctrlKey && e.key === "+")) {
        e.preventDefault();
        handleSkipPrevious();
      }
      if (e.key === "ArrowRight" || (e.ctrlKey && e.key === "-")) {
        e.preventDefault();
        handleSkipNext();
      }
      if (e.key === "Enter" || (e.ctrlKey && e.key === "]")) {
        e.preventDefault();
        console.log("Queue track");
      }
      if (e.key === " " && !e.shiftKey && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        handlePlayPause();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (shortcutsRef.current && !shortcutsRef.current.contains(e.target as Node)) {
        setShowShortcuts(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // SMTC event listener — backend sends instant updates on user actions + poll for position
  useEffect(() => {
    const unlisten = listen<TrackInfo>("smtc-update", (event) => {
      setTrackInfo(prev => {
        const next = event.payload;
        // Keep existing album art if the new event has none (e.g. from emit_current_state)
        // and we're still on the same track.
        if (!next.album_art && prev.album_art && next.title === prev.title) {
          return { ...next, album_art: prev.album_art };
        }
        return next;
      });
    });

    return () => {
      unlisten.then(f => f());
    }
  }, []);

  const progressPercent = trackInfo.duration > 0 
    ? (trackInfo.position / trackInfo.duration) * 100 
    : 0;

  return (
    <div className="container">
      {/* Search Header */}
      <div className="search-section">
        <div className="search-header">
          <div className="search-input-wrapper">
            <Search className="search-icon" size={18} />
            <input
              className="search-input"
              placeholder="Search or ask for music..."
              autoFocus
            />
            <div className="esc-hint">ESC</div>
          </div>
          <button
            className="settings-btn"
            onClick={() => setShowShortcuts(!showShortcuts)}
          >
            <Settings size={18} />
          </button>
        </div>

        {/* Shortcuts Dropdown */}
        <div className={`shortcuts-dropdown-wrapper ${showShortcuts ? 'visible' : ''}`}>
          <div className="shortcuts-dropdown" ref={shortcutsRef}>
            <div className="shortcuts-header">
              <span>Keyboard Shortcuts</span>
              <button 
                className="close-shortcuts" 
                onClick={(e) => { e.stopPropagation(); setShowShortcuts(false); }}
              >
                <X size={14} />
              </button>
            </div>
            <div className="shortcut-item">
              <div className="shortcut-keys">
                <kbd>Space</kbd>
              </div>
              <span>Play/Pause</span>
            </div>
            <div className="shortcut-item">
              <div className="shortcut-keys">
                <kbd>←</kbd>
              </div>
              <span>Previous track</span>
            </div>
            <div className="shortcut-item">
              <div className="shortcut-keys">
                <kbd>→</kbd>
              </div>
              <span>Next track</span>
            </div>
            <div className="shortcut-item">
              <div className="shortcut-keys">
                <kbd>Ctrl</kbd><kbd>+</kbd>
              </div>
              <span>Skip track</span>
            </div>
            <div className="shortcut-item">
              <div className="shortcut-keys">
                <kbd>Ctrl</kbd><kbd>-</kbd>
              </div>
              <span>Save track</span>
            </div>
            <div className="shortcut-item">
              <div className="shortcut-keys">
                <kbd>Ctrl</kbd><kbd>]</kbd>
              </div>
              <span>Queue track</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="main-content">
        <div className="now-playing-card">
          <div className="album-art">
            {trackInfo.album_art ? (
              <img src={trackInfo.album_art} alt="Album art" className="album-art-inner" />
            ) : (
              <div className="album-art-inner"></div>
            )}
          </div>
          <div className="track-info">
            <h2 className="track-title">{trackInfo.title || "No track"}</h2>
            <p className="track-artist">{trackInfo.artist || "Unknown artist"} · {trackInfo.album_title}</p>
            <div className="track-meta">
              <div className="badges">
                <span className="badge active">{trackInfo.status}</span>
              </div>
              <div className="progress-bar-container">
                <span>{formatTime(trackInfo.position)}</span>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progressPercent}%` }}></div>
                </div>
                <span>{formatTime(trackInfo.duration)}</span>
              </div>
            </div>
          </div>
          <div className="playback-controls">
            <button className="playback-control-btn" onClick={handleSkipPrevious}>
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button className="play-pause-btn" onClick={handlePlayPause}>
              {trackInfo.status === "Playing" ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
            </button>
            <button className="playback-control-btn" onClick={handleSkipNext}>
              <SkipForward size={18} fill="currentColor" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs">
          {["Discover", "Similar albums", "Queue"].map(tab => (
            <div
              key={tab}
              className={`tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </div>
          ))}
        </div>

        {/* Swipe Deck Area (Placeholder for Framer Motion) */}
        <div className="deck-container">
          <div className="swipe-card-area">
            {/* We will add Framer motion cards here */}
            <div className="swipe-card">
               <div className="album-art album-art-large"></div>
               <div className="swipe-card-content">
                  <h3 className="swipe-card-title">Levitating</h3>
                  <p className="swipe-card-artist">Dua Lipa · Future Nostalgia</p>
                  <div className="badges">
                    <span className="badge">Synth-pop</span>
                    <span className="badge">2020</span>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="footer">
        <div>Alt+Space to open</div>
        <div className="footer-icon">
          <PlusCircle size={14} /> Apple Music
        </div>
      </div>
    </div>
  );
}

export default App;
