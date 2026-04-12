# Wayward Project Overview

**Wayward** is a lightweight, background-running music recommendation overlay for Windows, heavily inspired by the snappy, keyboard-first aesthetic of Raycast.

## The Concept
The core idea is an always-on-top, frameless window that the user can summon immediately with a global shortcut (`Alt+W`). It reads whatever song is currently playing on the OS (e.g., via Apple Music or Spotify on Windows) and presents a deck of similar song and album recommendations that the user can interact with exclusively using keyboard bindings (skipping, saving to a playlist, or playing immediately).

## Tech Stack
- **Framework**: Tauri v2
- **Backend / OS Layer**: Rust (for OS hooks and window manipulation)
- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: Tailwind CSS 4 + Vanilla CSS (Design system with HSL-derived accents)
- **Animations / Gestures**: Framer Motion (current implementation for basic transitions; physics-based swipe deck pending)
- **Icons**: `lucide-react`

## Current Implementation Status
### 1. UI Shell & Aesthetics
- A responsive, keyboard-first UI shell built with modular components (e.g., `AmbientBackground`).
- **Performance Optimization**: Uses a persistent canvas-based `AmbientBackground` that renders soft radial gradients once per track change, minimizing GPU load (effective 0% usage during playback).
- The application natively uses `window-vibrancy` (`apply_acrylic`) in Rust. CSS backgrounds are kept highly transparent to let the Windows 11 acrylic effect push through.

### 2. OS & API Integration
- **SMTC**: Custom Rust module (`smtc.rs`) hooks into Windows Media Controls. It broadcasts metadata (`smtc-update`) and handles incoming commands (`toggle_playback`, `skip_next`, `skip_previous`).
- **Last.fm**: Fully functional backend integration fetches similar tracks, artist tags, and top albums based on the current SMTC seed.
- **Global Shortcut**: `tauri-plugin-global-shortcut` captures `Alt+W` to toggle window visibility and focus.

## Pending Development (Next Steps)
1. **Modular Architecture**: 
   - Refactor the monolithic `App.tsx` logic into the established `stores`, `hooks`, and component structure.
   - Transition state management to **Zustand**.
2. **Apple Music API Integration**: 
   - Awaiting Apple Developer keys.
   - Implement `MusicKit` JS to authenticate and play tracks directly from the overlay.
3. **Advanced Framer Motion Deck**: 
   - Implement physical swipe-to-dismiss/save logic and physics for the card deck.

## Agent Guidelines for Modifying this Project
- **Tauri V2 Specifics**: Ensure you are using Tauri v2 plugin syntax when modifying Rust.
- **Window Transparency**: Keep `index.css` and `App.css` backgrounds highly transparent (low RGBA alpha) otherwise the acrylic glass effect instantiated in `lib.rs` will be drawn over and look solid black/dark.
- **Async Rust WinRT**: Interacting with Windows COM/WinRT APIs requires proper async handling (`tauri::async_runtime::spawn`) and error unwraps—do not aggressively panic via `unwrap()` or `?` in the global `setup` hooks or the app will silently crash on boot.
- **Commit Guidelines**: Follow a strict conventional commit style: `type: lowercase description`. 
  - Valid types: `feat` (new features), `fix` (bug fixes), `style` (aesthetic/CSS tweaks), `perf` (optimizations), `refactor` (code structure changes).
  - Example: `style: lighten surface and card backgrounds` or `perf: reduce smtc poll rate`.

