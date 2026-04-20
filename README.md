# Wayward

Wayward is a lightweight music recommendation overlay for Windows created as a mock-up for a possible future Apple Music and Spotify integration. Built with Tauri, React, TypeScript, Rust, and developed agentically. It lives in the background, stays out of the taskbar, and can be summoned with `Alt+W` to surface context-aware recommendations based on the track currently playing on your system. Playback running through a browser is not currently detected; the app only responds to supported Windows media sessions.

The app is designed around a keyboard-first flow: fast reveal, quick actions, and minimal need to reach for a mouse or trackpad.


<img width="1837" height="924" alt="image" src="https://github.com/user-attachments/assets/60d39c37-32cc-4c8a-bc6a-2c8c26ec451d" />



## What It Does

- Watches the current media session through Windows SMTC integration.
- Pulls similar tracks, artist tags, and related albums from Last.fm.
- Opens as an always-on-top, frameless overlay.
- Supports keyboard-driven playback and recommendation navigation.
- Adapts the visual theme to the current track artwork and mood.

## Current Status

The core overlay shell is in place with a working recommendation pipeline:

- Windows media metadata is read through a custom Rust SMTC module.
- `Alt+W` toggles the hidden overlay and refreshes the current playback state.
- Last.fm lookup is wired up in the backend and validated through an in-app setup screen.
- The frontend is split into reusable components, hooks, stores, and utilities.
- Acrylic transparency is applied natively in Rust, with the CSS kept intentionally transparent.

Direct Apple Music playback is planned next.

## Stack

- Tauri v2
- Rust
- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Framer Motion
- Zustand
- `lucide-react`

## Getting Started

### Prerequisites

- Windows 10/11
- [Rust](https://www.rust-lang.org/tools/install)
- [Bun](https://bun.sh/)
- Microsoft C++ build tools if your Rust/Tauri setup needs them

### Install Dependencies

```bash
cd Wayward
bun install
```

### Configure Last.fm

Wayward needs a Last.fm API key before it can fetch recommendations.

You can either:

1. Create a local `.env` file in `Wayward/` with:

```env
LASTFM_API_KEY=your_key_here
```

2. Or launch the app and paste the key into the setup screen. After a successful verification request, Wayward writes the key back to the local `Wayward/.env` file for you.

### Run In Development

```bash
cd Wayward
bun run tauri dev
```

The Tauri config uses `bun run dev` for the frontend dev server and points the desktop shell at `http://localhost:1420`.

### Build

```bash
cd Wayward
bun run build
bun run tauri build
```

## Keyboard Controls

- `Alt+W`: show or hide the overlay
- `Esc`: hide the window
- `Space`: toggle playback
- `Left Arrow`: previous track
- `Right Arrow`: next track
- `1`: switch to Discover
- `2`: switch to Similar albums
- `J` / `L`: move through recommendation cards
- `C`: copy the active recommendation
- `S`: search the active recommendation
- `O`: toggle shortcut help

## Project Structure

```text
Wayward/
  src/
    components/   UI building blocks
    hooks/        playback, theming, keyboard, and Last.fm hooks
    lib/          shared helpers for tracks, actions, cache, and theme logic
    stores/       Zustand state stores
    types/        shared domain types

  src-tauri/
    src/lib.rs    Tauri entry point, window setup, shortcut registration
    src/smtc.rs   Windows media session integration
    src/lastfm.rs Last.fm setup, validation, and lookup logic
```

## License

This repository includes a [`LICENSE`](LICENSE) file at the workspace root.
