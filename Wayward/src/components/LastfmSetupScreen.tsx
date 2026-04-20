import { memo, useState } from "react";
import type { FormEvent } from "react";
import type { LastfmSetupUiStatus } from "../types/domain";

interface LastfmSetupScreenProps {
  status: LastfmSetupUiStatus;
  message: string | null;
  onSubmit: (apiKey: string) => Promise<void>;
}

function LastfmSetupScreen({ status, message, onSubmit }: LastfmSetupScreenProps) {
  const [apiKey, setApiKey] = useState("");
  const isChecking = status === "checking";
  const isSubmitting = status === "submitting";
  const isBusy = isChecking || isSubmitting;
  const title = status === "invalid"
    ? "Your Last.fm key needs attention"
    : "Connect Last.fm to continue";
  const body = status === "invalid"
    ? "The saved API key did not pass verification. Enter a working key to unlock recommendations."
    : "Wayward needs a valid Last.fm API key before it can build recommendations from the current track.";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy) {
      return;
    }

    void onSubmit(apiKey);
  };

  return (
    <div className="setup-stage">
      <div className="setup-panel">
        <span className="setup-kicker">Last.fm Setup</span>
        <h1 className="setup-title">{title}</h1>
        <p className="setup-body">{body}</p>

        <form className="setup-form" onSubmit={handleSubmit}>
          <label className="setup-label" htmlFor="lastfm-api-key">API key</label>
          <input
            id="lastfm-api-key"
            className="setup-input"
            type="password"
            autoComplete="off"
            autoFocus
            spellCheck={false}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Paste your Last.fm API key"
            disabled={isBusy}
          />

          <button className="setup-submit" type="submit" disabled={isBusy}>
            {isSubmitting ? "Verifying..." : "Verify and continue"}
          </button>
        </form>

        <div className="setup-feedback" aria-live="polite">
          {isChecking ? (
            <p className="setup-status">Checking your existing Last.fm setup...</p>
          ) : null}

          {!isChecking && message ? (
            <p className="setup-error">{message}</p>
          ) : null}
        </div>

        <p className="setup-note">
          The key is saved back into the app&apos;s local <code>.env</code> file only after a successful verification request.
        </p>
      </div>
    </div>
  );
}

export default memo(LastfmSetupScreen);
