import { useEffect } from "react";
import { usePlaybackStore } from "../stores/usePlaybackStore";

export function useThemeCssVars(): void {
  const accentTheme = usePlaybackStore((state) => state.accentTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent-c1", accentTheme.accent1);
    root.style.setProperty("--accent-c2", accentTheme.accent2);
    root.style.setProperty("--accent-glow", accentTheme.glow);
    root.style.setProperty("--surface-tint", accentTheme.surface);
    root.style.setProperty("--surface-strong", accentTheme.surfaceStrong);
    root.style.setProperty("--surface-border", accentTheme.border);
    root.style.setProperty("--accent-ink", accentTheme.accentInk);
    root.style.setProperty("--accent-shadow", accentTheme.shadow);
    root.style.setProperty("--text-primary", accentTheme.textPrimary);
    root.style.setProperty("--text-secondary", accentTheme.textSecondary);
    root.style.setProperty("--search-focus-border", accentTheme.searchFocusBorder);
    root.style.setProperty("--search-focus-ring", accentTheme.searchFocusRing);
    root.style.setProperty("--badge-bg", accentTheme.badgeBg);
    root.style.setProperty("--badge-muted-bg", accentTheme.badgeMutedBg);
    root.style.setProperty("--badge-border", accentTheme.badgeBorder);
    root.style.setProperty("--badge-muted-border", accentTheme.badgeMutedBorder);
    root.style.setProperty("--badge-shadow", accentTheme.badgeShadow);
    root.style.setProperty("--badge-text", accentTheme.badgeText);
    root.style.setProperty("--badge-muted-text", accentTheme.badgeMutedText);
    root.style.setProperty("--btn-hover-bg", accentTheme.btnHoverBg);
    root.style.setProperty("--btn-hover-border", accentTheme.btnHoverBorder);
    root.style.setProperty("--btn-hover-shadow", accentTheme.btnHoverShadow);
    root.style.setProperty("--ctrl-hover-border", accentTheme.ctrlHoverBorder);
    root.style.setProperty("--card-bg", accentTheme.cardBg);
  }, [accentTheme]);
}
