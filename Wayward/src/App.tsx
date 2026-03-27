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

/** Extract 2 dominant vibrant colours from a base64/URL image via canvas sampling */
function extractColours(src: string): Promise<[string, string]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      // Downsample for speed
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(["#8b5cf6", "#ec4899"]);
      ctx.drawImage(img, 0, 0, 32, 32);
      const data = ctx.getImageData(0, 0, 32, 32).data;

      // Collect colour buckets (skip near-black and near-white)
      const buckets: Record<string, { r: number; g: number; b: number; count: number }> = {};
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const brightness = (r + g + b) / 3;
        // Skip very dark or very light pixels
        if (brightness < 40 || brightness > 220) continue;
        // Quantise to 6-bit per channel bucket key
        const key = `${r >> 2},${g >> 2},${b >> 2}`;
        if (!buckets[key]) buckets[key] = { r, g, b, count: 0 };
        buckets[key].count++;
      }

      const sorted = Object.values(buckets).sort((a, b) => b.count - a.count);
      if (sorted.length === 0) return resolve(["#8b5cf6", "#ec4899"]);

      const toHex = (c: { r: number; g: number; b: number }) =>
        `#${[c.r, c.g, c.b].map(v => v.toString(16).padStart(2, "0")).join("")}`;

      const primary = sorted[0];
      // Pick second colour that is visually different from the first
      const secondary =
        sorted.find((c) => {
          const dr = Math.abs(c.r - primary.r);
          const dg = Math.abs(c.g - primary.g);
          const db = Math.abs(c.b - primary.b);
          return dr + dg + db > 80;
        }) ?? sorted[Math.min(1, sorted.length - 1)];

      resolve([toHex(primary), toHex(secondary)]);
    };
    img.onerror = () => resolve(["#8b5cf6", "#ec4899"]);
    img.src = src;
  });
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
  const [accentColours, setAccentColours] = useState<[string, string]>(["#8b5cf6", "#ec4899"]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const shortcutsAreaRef = useRef<HTMLDivElement>(null);
  const shortcutsRef = useRef<HTMLDivElement>(null);

  // Update CSS variables whenever accent colours change
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent-c1", accentColours[0]);
    root.style.setProperty("--accent-c2", accentColours[1]);
    // Also derive glow
    root.style.setProperty("--accent-glow", accentColours[0] + "55");
  }, [accentColours]);

  // Re-extract colours whenever album art changes
  useEffect(() => {
    if (trackInfo.album_art) {
      extractColours(trackInfo.album_art).then(setAccentColours);
    } else {
      setAccentColours(["#8b5cf6", "#ec4899"]);
    }
  }, [trackInfo.album_art]);

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

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowShortcuts(false);
        await getCurrentWindow().hide();
      }
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
      if (shortcutsAreaRef.current && !shortcutsAreaRef.current.contains(e.target as Node)) {
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

  useEffect(() => {
    const unlisten = listen<TrackInfo>("smtc-update", (event) => {
      setTrackInfo(prev => {
        const next = event.payload;
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
      {/* Dynamic ambient gradient background — reacts to album art colours */}
      <div className="ambient-gradient" aria-hidden="true" />

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
          <div className="shortcuts-area" ref={shortcutsAreaRef}>
            <button
              className="settings-btn"
              type="button"
              aria-expanded={showShortcuts}
              aria-haspopup="dialog"
              onClick={() => setShowShortcuts((prev) => !prev)}
            >
              <Settings size={18} />
            </button>
          {/* Shortcuts Dropdown */}
        <div className={`shortcuts-dropdown-wrapper ${showShortcuts ? 'visible' : ''}`}>
          <div className="shortcuts-dropdown" ref={shortcutsRef}>
            <div className="shortcuts-header">
              <span>Keyboard Shortcuts</span>
              <button
                className="close-shortcuts"
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowShortcuts(false); }}
              >
                <X size={14} />
              </button>
            </div>
            <div className="shortcut-item">
              <div className="shortcut-keys"><kbd>Space</kbd></div>
              <span>Play/Pause</span>
            </div>
            <div className="shortcut-item">
              <div className="shortcut-keys"><kbd>←</kbd></div>
              <span>Previous track</span>
            </div>
            <div className="shortcut-item">
              <div className="shortcut-keys"><kbd>→</kbd></div>
              <span>Next track</span>
            </div>
            <div className="shortcut-item">
              <div className="shortcut-keys"><kbd>Ctrl</kbd><kbd>+</kbd></div>
              <span>Skip track</span>
            </div>
            <div className="shortcut-item">
              <div className="shortcut-keys"><kbd>Ctrl</kbd><kbd>-</kbd></div>
              <span>Save track</span>
            </div>
            <div className="shortcut-item">
              <div className="shortcut-keys"><kbd>Ctrl</kbd><kbd>]</kbd></div>
              <span>Queue track</span>
            </div>
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
              <div className="album-art-inner" />
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
                  <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
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

        {/* Swipe Deck Area */}
        <div className="deck-container">
          <div className="swipe-card-area">
            <div className="swipe-card">
              <div className="album-art album-art-large" />
              <div className="swipe-card-content">
                <h3 className="swipe-card-title">King and Lionheart</h3>
                <p className="swipe-card-artist">Of Monsters and Men · My Head Is an Animal</p>
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
