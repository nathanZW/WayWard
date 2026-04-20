import { invoke } from "@tauri-apps/api/core";
import { memo, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import AmbientBackground from "./components/AmbientBackground";
import DeckLane from "./components/DeckLane";
import FooterBar from "./components/FooterBar";
import LastfmSetupScreen from "./components/LastfmSetupScreen";
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
import type { LastfmSetupState, LastfmSetupUiStatus } from "./types/domain";
import "./App.css";

function App() {
  useTauriPlaybackEvents();
  useAccentTheme();
  useThemeCssVars();

  const { accentTheme, idleState, windowVisible } = usePlaybackStore(useShallow((state) => ({
    accentTheme: state.accentTheme,
    idleState: isNeutralTrack(state.trackInfo),
    windowVisible: state.windowVisible
  })));

  const [setupStatus, setSetupStatus] = useState<LastfmSetupUiStatus>("checking");
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const setupReady = setupStatus === "ready";

  useLastfmContext(setupReady);
  useKeyboardShortcuts(setupReady);

  useEffect(() => {
    let cancelled = false;

    invoke<LastfmSetupState>("get_lastfm_setup_state")
      .then((state) => {
        if (cancelled) {
          return;
        }

        setSetupStatus(state.status);
        setSetupMessage(state.message);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSetupStatus("invalid");
        setSetupMessage(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSetupSubmit = async (apiKey: string) => {
    const trimmedKey = apiKey.trim();
    setSetupStatus("submitting");
    setSetupMessage(null);

    try {
      const state = await invoke<LastfmSetupState>("submit_lastfm_api_key", {
        apiKey: trimmedKey
      });

      setSetupStatus(state.status);
      setSetupMessage(state.message);
    } catch (error) {
      setSetupStatus("invalid");
      setSetupMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className={`container ${idleState ? "is-idle" : ""}${!windowVisible ? " is-hidden" : ""}`}>
      <AmbientBackground
        accent1={accentTheme.accent1}
        accent2={accentTheme.accent2}
        idle={idleState}
        hidden={!windowVisible}
      />

      {setupReady ? (
        <>
          <SearchBar />

          <div className="main-content">
            <NowPlayingCard />
            <TabsBar />
            <DeckLane />
          </div>

          <FooterBar />
        </>
      ) : (
        <LastfmSetupScreen
          status={setupStatus}
          message={setupMessage}
          onSubmit={handleSetupSubmit}
        />
      )}
    </div>
  );
}

export default memo(App);
