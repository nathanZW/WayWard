import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import AmbientBackground from "./components/AmbientBackground";
import DeckLane from "./components/DeckLane";
import FooterBar from "./components/FooterBar";
import NowPlayingCard from "./components/NowPlayingCard";
import SearchBar from "./components/SearchBar";
import TabsBar from "./components/TabsBar";
import { useAccentTheme } from "./hooks/useAccentTheme";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useLastfmContext } from "./hooks/useLastfmContext";
import { useTauriPlaybackEvents } from "./hooks/useTauriPlaybackEvents";
import { useThemeCssVars } from "./hooks/useThemeCssVars";
import { isNeutralTrack } from "./lib/track";
import { usePlaybackStore } from "./stores/usePlaybackStore";
import "./App.css";

function App() {
  useTauriPlaybackEvents();
  useLastfmContext();
  useAccentTheme();
  useThemeCssVars();
  useKeyboardShortcuts();

  const { accentTheme, idleState, windowVisible } = usePlaybackStore(useShallow((state) => ({
    accentTheme: state.accentTheme,
    idleState: isNeutralTrack(state.trackInfo),
    windowVisible: state.windowVisible
  })));

  return (
    <div className={`container ${idleState ? "is-idle" : ""}${!windowVisible ? " is-hidden" : ""}`}>
      <AmbientBackground
        accent1={accentTheme.accent1}
        accent2={accentTheme.accent2}
        idle={idleState}
        hidden={!windowVisible}
      />

      <SearchBar />

      <div className="main-content">
        <NowPlayingCard />
        <TabsBar />
        <DeckLane />
      </div>

      <FooterBar />
    </div>
  );
}

export default memo(App);
