import { memo, useEffect, useRef } from "react";
import { Search, Settings, X } from "lucide-react";
import { useUiStore } from "../stores/useUiStore";

function SearchBar() {
  const showShortcuts = useUiStore((state) => state.showShortcuts);
  const setShowShortcuts = useUiStore((state) => state.setShowShortcuts);
  const shortcutsAreaRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (shortcutsAreaRef.current && !shortcutsAreaRef.current.contains(event.target as Node)) {
        setShowShortcuts(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [setShowShortcuts]);

  return (
    <div className="search-section">
      <div className="search-header">
        <div className="search-input-wrapper">
          <Search className="search-icon" size={18} />
          <input
            ref={searchInputRef}
            className="search-input"
            placeholder="Search"
            autoFocus
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              setShowShortcuts(false);
              searchInputRef.current?.blur();
            }}
          />
          <div className="esc-hint">ESC</div>
        </div>

        <div className="shortcuts-area" ref={shortcutsAreaRef}>
          <button
            className="settings-btn"
            type="button"
            aria-expanded={showShortcuts}
            aria-haspopup="dialog"
            onClick={() => setShowShortcuts((current) => !current)}
          >
            <Settings size={18} />
          </button>

          <div className={`shortcuts-dropdown-wrapper ${showShortcuts ? "visible" : ""}`}>
            <div className="shortcuts-dropdown">
              <div className="shortcuts-header">
                <span>Keyboard Shortcuts</span>
                <button
                  className="close-shortcuts"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowShortcuts(false);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="shortcuts-list">
                <div className="shortcut-item">
                  <div className="shortcut-keys"><kbd>O</kbd></div>
                  <span>Toggle shortcuts</span>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-keys"><kbd>Space</kbd></div>
                  <span>Play/Pause</span>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-keys"><kbd>&larr;</kbd></div>
                  <span>Previous track</span>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-keys"><kbd>&rarr;</kbd></div>
                  <span>Next track</span>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-keys"><kbd>1</kbd></div>
                  <span>Discover</span>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-keys"><kbd>2</kbd></div>
                  <span>Similar albums</span>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-keys"><kbd>J</kbd></div>
                  <span>Previous card</span>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-keys"><kbd>L</kbd></div>
                  <span>Next card</span>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-keys"><kbd>C</kbd></div>
                  <span>Copy active card</span>
                </div>
                <div className="shortcut-item">
                  <div className="shortcut-keys"><kbd>S</kbd></div>
                  <span>Search active card</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(SearchBar);
