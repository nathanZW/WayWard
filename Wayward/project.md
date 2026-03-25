# Wayward Project Overview

**Wayward** is a lightweight, background-running music recommendation overlay for Windows, heavily inspired by the snappy, keyboard-first aesthetic of Raycast.

## The Concept
The core idea is an always-on-top, frameless window that the user can summon immediately with a global shortcut (`Alt+Space`). It reads whatever song is currently playing on the OS (e.g., via Apple Music or Spotify on Windows) and presents a Tinder-like deck of similar song recommendations that the user can interact with exclusively using keyboard bindings (skipping, saving to a playlist, or playing immediately).

## Tech Stack
- **Framework**: Tauri v2
- **Backend / OS Layer**: Rust (for OS hooks and window manipulation)
- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: Vanilla CSS (CSS variables, dark theme tailored to match aesthetic mockups)
- **Animations / Gestures**: Framer Motion (pending implementation for the swipe deck)
- **Icons**: `lucide-react`

## Current Implementation Status
### 1. UI Shell & Aesthetics
- A responsive, keyboard-first UI shell built in `App.tsx` and `App.css`.
- The application natively uses `window-vibrancy` (`apply_acrylic`) in Rust to establish an OS-level frosted glass effect. CSS opacities are tuned very low to allow this Windows 11 acrylic aesthetic to push through the UI elements.
- Simulated keyboard event hooks map Left/Right arrows and Enter to visually press action buttons.

### 2. Windows OS Integration
- Custom Rust module (`src-tauri/src/smtc.rs`) actively hooking into `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager`. This tracks active system audio metadata (Title, Artist, Album, Status) and broadcasts it to the frontend via a Tauri event (`smtc-update`).
- Rust handles the global shortcut: `tauri-plugin-global-shortcut` captures `Alt+Space` to dynamically `.show()`/`.hide()` and focus the window without flickering.

## Pending Development (Next Steps)
1. **Apple Music API Integration**: 
   - Awaiting Apple Developer keys.
   - Implement `MusicKit` JS to authenticate the user.
   - Map the SMTC-provided track ID to the `catalog/search` and fetch `recommendations` endpoints to replace the currently static mock data in the swipe deck.
2. **Framer Motion Deck**: 
   - Implement the physical swipe animations.
   - Hook up the keyboard shortcuts actually triggering the dismiss/save actions logically, queueing up the "Wayward Saved" playlist API calls.

## Agent Guidelines for Modifying this Project
- **Tauri V2 Specifics**: Ensure you are using Tauri v2 plugin syntax when modifying Rust.
- **Window Transparency**: Keep `index.css` and `App.css` backgrounds highly transparent (low RGBA alpha) otherwise the acrylic glass effect instantiated in `lib.rs` will be drawn over and look solid black/dark.
- **Async Rust WinRT**: Interacting with Windows COM/WinRT APIs requires proper async handling (`tauri::async_runtime::spawn`) and error unwraps—do not aggressively panic via `unwrap()` or `?` in the global `setup` hooks or the app will silently crash on boot.
