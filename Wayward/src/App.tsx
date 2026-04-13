import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pause,
  Play,
  PlusCircle,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  X
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AmbientBackground from "./components/AmbientBackground";
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

interface LastfmSource {
  url: string | null;
  listeners: string | null;
  playcount: string | null;
  tags: string[];
}

interface LastfmTrackMatch {
  name: string;
  artist: string;
  album: string | null;
  image_url: string | null;
  url: string | null;
  match_score: number | null;
}

interface LastfmAlbumMatch {
  name: string;
  artist: string;
  image_url: string | null;
  url: string | null;
  listeners: string | null;
  rank: number | null;
}

interface LastfmContext {
  source: LastfmSource;
  similar_tracks: LastfmTrackMatch[];
  top_albums: LastfmAlbumMatch[];
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface ColourBucketAnalysis {
  colour: RGB;
  score: number;
  saturation: number;
  brightness: number;
}

interface ColourAnalysis {
  totalPixels: number;
  sampledPixels: number;
  acceptedPixels: number;
  rejectedPixels: number;
  rejectionRate: number;
  averageSaturation: number;
  weightedAverageSaturation: number;
  averageBrightness: number;
  averageAlpha: number;
  topBuckets: ColourBucketAnalysis[];
}

interface HSL {
  h: number;
  s: number;
  l: number;
}

interface BadgeStyle {
  background: string;
  border: string;
  shadow: string;
}

interface AccentTheme {
  accent1: string;
  accent2: string;
  glow: string;
  surface: string;
  surfaceStrong: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  accentInk: string;
  shadow: string;
  mood: string;
  searchFocusBorder: string;
  searchFocusRing: string;
  badgeBg: string;
  badgeMutedBg: string;
  badgeBorder: string;
  badgeMutedBorder: string;
  badgeShadow: string;
  btnHoverBg: string;
  btnHoverBorder: string;
  btnHoverShadow: string;
  ctrlHoverBorder: string;
  cardBg: string;
}

interface DeckCard {
  key: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  badges: string[];
  note: string;
  imageSrc: string | null;
}

interface NormalizedTrackMetadata {
  lookupTitle: string;
  lookupArtist: string;
  displayArtist: string;
  displayAlbum: string;
}

const APP_TABS = ["Discover", "Similar albums", "Queue"] as const;
type AppTab = typeof APP_TABS[number];
type LaneTab = Extract<AppTab, "Discover" | "Similar albums">;
type LaneMotionDirection = "forward" | "backward";

const NEUTRAL_TRACK: TrackInfo = {
  title: "",
  artist: "",
  album_artist: "",
  album_title: "",
  status: "Idle",
  position: 0,
  duration: 0,
  album_art: null
};

const NEUTRAL_ACCENT: [string, string] = ["#f2ede4", "#d7d1c8"];
const LIVE_FALLBACK_ACCENT: [string, string] = ["#8b5cf6", "#ec4899"];
const SAMPLE_SIZE = 24;
const LIVE_SATURATION_BOOST = 0.16;
const LIVE_LIGHTNESS_BOOST = 0.03;
const COLOR_DEBUG_ENABLED = Boolean(
  typeof window !== "undefined"
  && window.localStorage.getItem("wayward.debugColor") === "1"
);

const DARK_RGB: RGB = { r: 13, g: 15, b: 20 };
const LIGHT_RGB: RGB = { r: 248, g: 244, b: 236 };
const OFF_WHITE_RGB: RGB = { r: 255, g: 250, b: 244 };
const BADGE_TEXT_MIN_CONTRAST = 4.5;
const BADGE_SURFACE_MIN_CONTRAST = 1.18;

let paletteContext: CanvasRenderingContext2D | null = null;

function isNeutralTrack(track: TrackInfo): boolean {
  return !track.title.trim()
    && !track.artist.trim()
    && !track.album_title.trim()
    && !track.album_art
    && track.duration <= 0;
}

function formatTime(secs: number): string {
  if (secs <= 0 || !Number.isFinite(secs)) return "0:00";
  const totalSeconds = Math.round(secs);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string): RGB {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  };
}

function toHex(rgb: RGB): string {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function toRgba(rgb: RGB, alpha: number): string {
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${clamp(alpha, 0, 1)})`;
}

function mixRgb(from: RGB, to: RGB, amount: number): RGB {
  const ratio = clamp(amount, 0, 1);
  return {
    r: from.r + (to.r - from.r) * ratio,
    g: from.g + (to.g - from.g) * ratio,
    b: from.b + (to.b - from.b) * ratio
  };
}

function compositeRgb(backdrop: RGB, overlay: RGB, alpha: number): RGB {
  const opacity = clamp(alpha, 0, 1);
  return {
    r: overlay.r * opacity + backdrop.r * (1 - opacity),
    g: overlay.g * opacity + backdrop.g * (1 - opacity),
    b: overlay.b * opacity + backdrop.b * (1 - opacity)
  };
}

function rgbToHsl(rgb: RGB): HSL {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  if (delta !== 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }

  return {
    h: h < 0 ? h + 360 : h,
    s,
    l
  };
}

function hslToRgb(hsl: HSL): RGB {
  const hue = ((hsl.h % 360) + 360) % 360;
  const saturation = clamp(hsl.s, 0, 1);
  const lightness = clamp(hsl.l, 0, 1);
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));

  let r = 0;
  let g = 0;
  let b = 0;

  if (segment >= 0 && segment < 1) {
    r = chroma;
    g = x;
  } else if (segment < 2) {
    r = x;
    g = chroma;
  } else if (segment < 3) {
    g = chroma;
    b = x;
  } else if (segment < 4) {
    g = x;
    b = chroma;
  } else if (segment < 5) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }

  const match = lightness - chroma / 2;
  return {
    r: (r + match) * 255,
    g: (g + match) * 255,
    b: (b + match) * 255
  };
}

function getLuminance(rgb: RGB): number {
  const channels = [rgb.r, rgb.g, rgb.b].map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function getContrastRatio(a: RGB, b: RGB): number {
  const lighter = Math.max(getLuminance(a), getLuminance(b));
  const darker = Math.min(getLuminance(a), getLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function getSaturation(rgb: RGB): number {
  const max = Math.max(rgb.r, rgb.g, rgb.b) / 255;
  const min = Math.min(rgb.r, rgb.g, rgb.b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}

function getDistance(a: RGB, b: RGB): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function getHueDistance(a: number, b: number): number {
  const difference = Math.abs(a - b);
  return Math.min(difference, 360 - difference);
}

function rotateHue(hue: number, amount: number): number {
  return ((hue + amount) % 360 + 360) % 360;
}

function getWarmth(rgb: RGB): number {
  const warmth = (rgb.r + rgb.g - rgb.b * 1.35) / 255;
  return clamp(warmth, -1, 1);
}

function normalizeAccent(rgb: RGB, idle: boolean): RGB {
  const hsl = rgbToHsl(rgb);
  const minimumSaturation = idle ? 0.06 : 0.3;
  const maximumSaturation = idle ? 0.24 : 0.92;
  const minimumLightness = idle ? 0.72 : 0.34;
  const maximumLightness = idle ? 0.9 : 0.68;
  const saturationBoost = idle ? 0 : LIVE_SATURATION_BOOST;
  const lightnessBoost = idle ? 0 : LIVE_LIGHTNESS_BOOST;

  return hslToRgb({
    h: hsl.h,
    s: clamp(
      hsl.s < minimumSaturation
        ? minimumSaturation + (hsl.s * 0.45)
        : hsl.s + saturationBoost,
      minimumSaturation,
      maximumSaturation
    ),
    l: clamp(hsl.l + lightnessBoost, minimumLightness, maximumLightness)
  });
}

function deriveSecondaryAccent(primary: RGB, candidates: RGB[], idle: boolean): RGB {
  const primaryHsl = rgbToHsl(primary);

  const bestCandidate = candidates
    .filter((candidate) => getDistance(candidate, primary) > 36)
    .map((candidate) => {
      const candidateHsl = rgbToHsl(candidate);
      const contrast = Math.abs(getLuminance(candidate) - getLuminance(primary));
      const hueDistance = getHueDistance(candidateHsl.h, primaryHsl.h) / 180;
      const warmth = Math.max(0, getWarmth(candidate));
      const saturation = candidateHsl.s;
      const brightness = candidateHsl.l;

      return {
        colour: candidate,
        score:
          saturation * 3.2 +
          contrast * 2.8 +
          hueDistance * 1.7 +
          warmth * 1.6 +
          brightness * 0.9
      };
    })
    .sort((left, right) => right.score - left.score)[0]?.colour;

  if (bestCandidate) {
    return normalizeAccent(bestCandidate, idle);
  }

  const derivedHue = primaryHsl.h >= 80 && primaryHsl.h <= 220
    ? rotateHue(primaryHsl.h, -42)
    : rotateHue(primaryHsl.h, 28);

  return normalizeAccent(hslToRgb({
    h: derivedHue,
    s: clamp(primaryHsl.s + (idle ? 0.06 : 0.18), idle ? 0.1 : 0.32, 0.78),
    l: clamp(primaryHsl.l + (idle ? 0.04 : 0.16), idle ? 0.74 : 0.38, idle ? 0.9 : 0.68)
  }), idle);
}

function describeMood(rgb: RGB, idle: boolean): string {
  if (idle) return "Soft focus";

  const luminance = getLuminance(rgb);
  const saturation = getSaturation(rgb);

  if (saturation > 0.54 && luminance < 0.3) return "Velvet neon";
  if (saturation > 0.45 && luminance > 0.5) return "Sunlit pulse";
  if (saturation < 0.24 && luminance > 0.48) return "Airy haze";
  if (luminance < 0.22) return "After-hours";
  return "Midnight glow";
}

function createContrastAwareBadgeStyle(
  base: RGB,
  surface: RGB,
  primary: RGB,
  secondary: RGB,
  options?: {
    minimumTextContrast?: number;
    minimumSurfaceContrast?: number;
    minimumAlpha?: number;
    maximumAlpha?: number;
  }
): BadgeStyle {
  const minimumTextContrast = options?.minimumTextContrast ?? BADGE_TEXT_MIN_CONTRAST;
  const minimumSurfaceContrast = options?.minimumSurfaceContrast ?? BADGE_SURFACE_MIN_CONTRAST;
  const minimumAlpha = options?.minimumAlpha ?? 0.32;
  const maximumAlpha = options?.maximumAlpha ?? 0.82;
  const darknessSteps = [0, 0.08, 0.16, 0.24, 0.32, 0.42, 0.52, 0.62];

  let selectedFill = mixRgb(base, DARK_RGB, 0.42);
  let selectedAlpha = maximumAlpha;

  outer: for (const darkness of darknessSteps) {
    const fill = darkness === 0 ? base : mixRgb(base, DARK_RGB, darkness);

    for (let alpha = minimumAlpha; alpha <= maximumAlpha + 0.001; alpha += 0.06) {
      const visibleFill = compositeRgb(surface, fill, alpha);

      if (
        getContrastRatio(visibleFill, OFF_WHITE_RGB) >= minimumTextContrast
        && getContrastRatio(visibleFill, surface) >= minimumSurfaceContrast
      ) {
        selectedFill = fill;
        selectedAlpha = alpha;
        break outer;
      }
    }
  }

  return {
    background: toRgba(selectedFill, selectedAlpha),
    border: toRgba(mixRgb(selectedFill, primary, 0.36), clamp(selectedAlpha + 0.1, 0.42, 0.92)),
    shadow: toRgba(mixRgb(selectedFill, secondary, 0.22), clamp(selectedAlpha * 0.5, 0.18, 0.38))
  };
}

function buildAccentTheme(primaryInput: RGB, secondaryInput: RGB, idle: boolean): AccentTheme {
  const primary = normalizeAccent(primaryInput, idle);
  let secondary = normalizeAccent(secondaryInput, idle);

  if (getDistance(primary, secondary) < 72) {
    secondary = deriveSecondaryAccent(primary, [secondaryInput], idle);
  }

  const blend = mixRgb(primary, secondary, idle ? 0.42 : 0.34);
  const surfaceBase = mixRgb(blend, DARK_RGB, idle ? 0.82 : 0.48);
  const badgeStyle = createContrastAwareBadgeStyle(
    mixRgb(primary, { r: 255, g: 255, b: 255 }, 0.7),
    surfaceBase,
    primary,
    secondary,
    {
      minimumAlpha: idle ? 0.24 : 0.32,
      maximumAlpha: idle ? 0.68 : 0.82
    }
  );
  const badgeMutedStyle = createContrastAwareBadgeStyle(
    mixRgb(blend, { r: 255, g: 255, b: 255 }, idle ? 0.68 : 0.62),
    surfaceBase,
    secondary,
    primary,
    {
      minimumSurfaceContrast: 1.12,
      minimumAlpha: idle ? 0.22 : 0.28,
      maximumAlpha: idle ? 0.62 : 0.76
    }
  );
  const accentInk = getContrastRatio(blend, LIGHT_RGB) >= getContrastRatio(blend, DARK_RGB)
    ? toHex(LIGHT_RGB)
    : toHex(DARK_RGB);

  return {
    accent1: toHex(primary),
    accent2: toHex(secondary),
    glow: toRgba(mixRgb(primary, secondary, 0.32), idle ? 0.24 : 0.46),
    surface: toRgba(mixRgb(blend, DARK_RGB, idle ? 0.82 : 0.48), idle ? 0.35 : 0.46),
    surfaceStrong: toRgba(mixRgb(blend, DARK_RGB, idle ? 0.72 : 0.38), idle ? 0.45 : 0.54),
    border: toRgba(mixRgb(blend, LIGHT_RGB, idle ? 0.42 : 0.18), idle ? 0.25 : 0.3),
    textPrimary: toRgba(mixRgb(blend, OFF_WHITE_RGB, 0.88), 0.98),
    textSecondary: toRgba(mixRgb(blend, OFF_WHITE_RGB, 0.68), idle ? 0.65 : 0.82),
    accentInk,
    shadow: toRgba(mixRgb(primary, DARK_RGB, 0.58), idle ? 0.35 : 0.55),
    mood: describeMood(blend, idle),
    searchFocusBorder: toRgba(primary, 0.62),
    searchFocusRing: toRgba(primary, 0.28),
    badgeBg: badgeStyle.background,
    badgeMutedBg: badgeMutedStyle.background,
    badgeBorder: badgeStyle.border,
    badgeMutedBorder: badgeMutedStyle.border,
    badgeShadow: badgeStyle.shadow,
    btnHoverBg: toRgba(mixRgb(primary, { r: 255, g: 255, b: 255 }, 0.76), 0.32),
    btnHoverBorder: toRgba(primary, 0.38),
    btnHoverShadow: toRgba(mixRgb(primary, secondary, 0.3), 0.38),
    ctrlHoverBorder: toRgba(primary, 0.28),
    cardBg: toRgba(mixRgb(blend, { r: 10, g: 12, b: 18 }, 0.02), 0.56)
  };
}

function createThemeFromHex(accents: [string, string], idle: boolean): AccentTheme {
  return buildAccentTheme(hexToRgb(accents[0]), hexToRgb(accents[1]), idle);
}

function getPaletteContext(): CanvasRenderingContext2D | null {
  if (paletteContext) return paletteContext;
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  paletteContext = canvas.getContext("2d", { willReadFrequently: true });
  return paletteContext;
}

function extractColours(src: string): Promise<[RGB, RGB]> {
  const fallback: [RGB, RGB] = [
    hexToRgb(LIVE_FALLBACK_ACCENT[0]),
    hexToRgb(LIVE_FALLBACK_ACCENT[1])
  ];

  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";

    image.onload = () => {
      const context = getPaletteContext();
      if (!context) {
        resolve(fallback);
        return;
      }

      context.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      const data = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;

      const buckets = new Map<string, { r: number; g: number; b: number; weight: number; hits: number }>();
      let acceptedPixels = 0;
      let rejectedPixels = 0;
      let saturationSum = 0;
      let weightedSaturationSum = 0;
      let brightnessSum = 0;
      let alphaSum = 0;

      for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3] / 255;
        if (alpha < 0.6) {
          rejectedPixels += 1;
          continue;
        }

        const pixel = {
          r: data[index],
          g: data[index + 1],
          b: data[index + 2]
        };

        const brightness = (pixel.r + pixel.g + pixel.b) / 3;
        const saturation = getSaturation(pixel);

        if (brightness < 18 || brightness > 238) {
          rejectedPixels += 1;
          continue;
        }
        if (brightness > 215 && saturation < 0.12) {
          rejectedPixels += 1;
          continue;
        }

        const key = [
          Math.round(pixel.r / 18) * 18,
          Math.round(pixel.g / 18) * 18,
          Math.round(pixel.b / 18) * 18
        ].join(",");

        const weight = 0.75 + saturation * 6.2 + Math.abs(brightness - 128) / 192 + alpha * 0.8;
        const bucket = buckets.get(key);
        acceptedPixels += 1;
        saturationSum += saturation;
        weightedSaturationSum += saturation * weight;
        brightnessSum += brightness;
        alphaSum += alpha;

        if (bucket) {
          bucket.r += pixel.r;
          bucket.g += pixel.g;
          bucket.b += pixel.b;
          bucket.weight += weight;
          bucket.hits += 1;
        } else {
          buckets.set(key, {
            r: pixel.r,
            g: pixel.g,
            b: pixel.b,
            weight,
            hits: 1
          });
        }
      }

      const ranked = [...buckets.values()]
        .map((bucket) => ({
          colour: {
            r: bucket.r / bucket.hits,
            g: bucket.g / bucket.hits,
            b: bucket.b / bucket.hits
          },
          score: bucket.weight
        }))
        .sort((left, right) => right.score - left.score);

      if (ranked.length === 0) {
        resolve(fallback);
        return;
      }

      const analysis: ColourAnalysis = {
        totalPixels: data.length / 4,
        sampledPixels: acceptedPixels + rejectedPixels,
        acceptedPixels,
        rejectedPixels,
        rejectionRate: (rejectedPixels / Math.max(acceptedPixels + rejectedPixels, 1)),
        averageSaturation: saturationSum / Math.max(acceptedPixels, 1),
        weightedAverageSaturation: weightedSaturationSum / Math.max(acceptedPixels, 1),
        averageBrightness: brightnessSum / Math.max(acceptedPixels, 1),
        averageAlpha: alphaSum / Math.max(acceptedPixels, 1),
        topBuckets: ranked.slice(0, 5).map((entry) => ({
          colour: entry.colour,
          score: entry.score,
          saturation: rgbToHsl(entry.colour).s,
          brightness: rgbToHsl(entry.colour).l
        }))
      };

      const primary = ranked[0].colour;
      const secondaryCandidate = ranked
        .slice(1)
        .map((entry) => {
          const colour = entry.colour;
          const colourHsl = rgbToHsl(colour);
          const primaryHue = rgbToHsl(primary).h;
          const hueDistance = getHueDistance(colourHsl.h, primaryHue) / 180;
          const contrast = Math.abs(getLuminance(colour) - getLuminance(primary));
          const warmth = Math.max(0, getWarmth(colour));

          return {
            colour,
            score:
              entry.score * 0.35 +
              colourHsl.s * 3.8 +
              hueDistance * 1.8 +
              contrast * 2.2 +
              warmth * 1.5 +
              colourHsl.l * 0.9
          };
        })
        .sort((left, right) => right.score - left.score)[0]?.colour;

      const secondary = secondaryCandidate ?? deriveSecondaryAccent(primary, [], false);

      if (COLOR_DEBUG_ENABLED) {
        const primaryTheme = normalizeAccent(primary, false);
        const secondaryTheme = normalizeAccent(secondary, false);
        const primaryHsl = rgbToHsl(primary);
        const secondaryHsl = rgbToHsl(secondary);
        const primaryThemeHsl = rgbToHsl(primaryTheme);
        const secondaryThemeHsl = rgbToHsl(secondaryTheme);

        console.groupCollapsed("[Wayward] colour analysis");
        console.table({
          accepted_pixels: analysis.acceptedPixels,
          rejected_pixels: analysis.rejectedPixels,
          rejection_rate: Number(analysis.rejectionRate.toFixed(3)),
          raw_avg_saturation: Number(analysis.averageSaturation.toFixed(3)),
          raw_weighted_saturation: Number(analysis.weightedAverageSaturation.toFixed(3)),
          raw_avg_brightness: Number(analysis.averageBrightness.toFixed(1)),
          raw_avg_alpha: Number(analysis.averageAlpha.toFixed(3)),
          primary_saturation: Number(primaryHsl.s.toFixed(3)),
          primary_lightness: Number(primaryHsl.l.toFixed(3)),
          primary_theme_saturation: Number(primaryThemeHsl.s.toFixed(3)),
          primary_theme_lightness: Number(primaryThemeHsl.l.toFixed(3)),
          secondary_saturation: Number(secondaryHsl.s.toFixed(3)),
          secondary_lightness: Number(secondaryHsl.l.toFixed(3)),
          secondary_theme_saturation: Number(secondaryThemeHsl.s.toFixed(3)),
          secondary_theme_lightness: Number(secondaryThemeHsl.l.toFixed(3))
        });
        console.table(
          analysis.topBuckets.map((bucket, index) => ({
            rank: index + 1,
            colour: toHex(bucket.colour),
            score: Number(bucket.score.toFixed(3)),
            saturation: Number(bucket.saturation.toFixed(3)),
            brightness: Number(bucket.brightness.toFixed(3))
          }))
        );
        console.groupEnd();
      }

      resolve([primary, secondary]);
    };

    image.onerror = () => resolve(fallback);
    image.src = src;
  });
}

const LOOKUP_SUFFIX_KEYWORDS = [
  "feat",
  "ft.",
  "with ",
  "live",
  "remaster",
  "remix",
  "mix",
  "version",
  "edit",
  "mono",
  "stereo",
  "acoustic",
  "instrumental",
  "karaoke",
  "bonus",
  "radio edit",
  "clean",
  "explicit"
];

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function shouldStripLookupSuffix(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return LOOKUP_SUFFIX_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function stripTrailingLookupEnclosure(value: string): string {
  const match = value.match(/^(.*?)(?:\s*[\(\[\{]([^\(\)\[\]\{\}]*)[\)\]\}])$/);
  if (!match) return value;

  const [, head = "", inner = ""] = match;
  return shouldStripLookupSuffix(inner) ? collapseWhitespace(head) : value;
}

function stripTrailingLookupSuffix(value: string): string {
  for (const separator of [" - ", " \u2013 ", " \u2014 ", ": "]) {
    const index = value.lastIndexOf(separator);
    if (index <= 0) continue;

    const suffix = value.slice(index + separator.length);
    if (shouldStripLookupSuffix(suffix)) {
      return collapseWhitespace(value.slice(0, index));
    }
  }

  return value;
}

function normalizeLookupTitle(title: string): string {
  let normalized = collapseWhitespace(title);

  while (normalized) {
    const stripped = stripTrailingLookupSuffix(stripTrailingLookupEnclosure(normalized));
    if (stripped === normalized) {
      break;
    }

    normalized = stripped;
  }

  return normalized || collapseWhitespace(title);
}

function normalizeTrackMetadata(trackInfo: TrackInfo): NormalizedTrackMetadata {
  const rawTitle = trackInfo.title.trim();
  const rawArtist = trackInfo.artist.trim();
  const rawAlbumArtist = trackInfo.album_artist.trim();
  const rawAlbumTitle = trackInfo.album_title.trim();
  const splitArtistCandidate = (value: string) => {
    const splitMatch = value.match(/^(.+?)\s(?:\u2014|\u2013)\s(.+)$/);
    return {
      artist: splitMatch?.[1]?.trim() ?? value,
      album: splitMatch?.[2]?.trim() ?? ""
    };
  };

  const artistCandidate = splitArtistCandidate(rawArtist);
  const albumArtistCandidate = splitArtistCandidate(rawAlbumArtist);
  const preferredArtistCandidate = albumArtistCandidate.artist || artistCandidate.artist;
  const preferredAlbumCandidate = rawAlbumTitle || albumArtistCandidate.album || artistCandidate.album;

  return {
    lookupTitle: normalizeLookupTitle(rawTitle),
    lookupArtist: preferredArtistCandidate,
    displayArtist: preferredArtistCandidate,
    displayAlbum: preferredAlbumCandidate
  };
}

function buildLookupKey(normalizedTrack: NormalizedTrackMetadata): string {
  return [normalizedTrack.lookupTitle, normalizedTrack.lookupArtist, normalizedTrack.displayAlbum]
    .map((value) => value.trim().toLowerCase())
    .join("\u241f");
}

function formatMetric(value: string | null | undefined, label: string): string | null {
  if (!value) return null;
  const normalized = Number.parseInt(value.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(normalized)) return null;

  return `${new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(normalized)} ${label}`;
}

function createSingleCard(
  key: string,
  eyebrow: string,
  title: string,
  subtitle: string,
  badges: string[],
  note: string,
  imageSrc: string | null
): DeckCard {
  return {
    key,
    eyebrow,
    title,
    subtitle,
    badges,
    note,
    imageSrc
  };
}

function buildIdleCard(tab: AppTab, mood: string): DeckCard {
  return createSingleCard(
    `${tab}-idle`,
    tab,
    tab === "Queue"
      ? "Queue is parked until integrations land"
      : "Start Apple Music, Amazon Music, Spotify, TIDAL, Deezer, or YouTube Music",
    "Wayward is standing by for a supported music app.",
    [mood, "Standby"],
    "Once playback starts, Wayward will fetch similar tracks and artist album context from Last.fm.",
    null
  );
}

function buildDiscoverCards(
  trackInfo: TrackInfo,
  normalizedTrack: NormalizedTrackMetadata,
  context: LastfmContext | null,
  mood: string,
  status: "idle" | "loading" | "ready" | "error",
  errorMessage: string | null
): DeckCard[] {
  if (status === "loading") {
    return [createSingleCard(
      "discover-loading",
      "Discover",
      "Finding a nearby left turn",
      `${normalizedTrack.displayArtist} / ${trackInfo.title}`,
      ["Last.fm", "Scanning"],
      "Pulling similar tracks and tags from Last.fm for the current song.",
      trackInfo.album_art
    )];
  }

  if (status === "error") {
    return [createSingleCard(
      "discover-error",
      "Discover",
      "No Last.fm match yet",
      `${normalizedTrack.displayArtist} / ${trackInfo.title}`,
      ["Last.fm", mood],
      errorMessage ?? "Last.fm could not map this track right now.",
      trackInfo.album_art
    )];
  }

  if (!context || context.similar_tracks.length === 0) {
    return [createSingleCard(
      "discover-empty",
      "Discover",
      "No similar tracks surfaced",
      `${normalizedTrack.displayArtist} / ${trackInfo.title}`,
      ["Last.fm", mood],
      "Try another track. Last.fm did not return similar songs for this one.",
      trackInfo.album_art
    )];
  }

  const metrics = [
    formatMetric(context.source.listeners, "listeners"),
    formatMetric(context.source.playcount, "plays")
  ].filter(Boolean) as string[];
  const badges = context.source.tags.slice(0, 2);

  return context.similar_tracks.map((item, index) => createSingleCard(
    `discover-${index}-${item.artist}-${item.name}`,
    "Discover",
    item.name,
    [item.artist, item.album].filter(Boolean).join(" / "),
    badges.length > 0 ? badges : ["Last.fm", mood],
    index === 0
      ? metrics.length > 0
        ? `Seeded from ${trackInfo.title}. ${metrics.join(" / ")} on Last.fm.`
        : `Closest track match Last.fm found for ${trackInfo.title}.`
      : metrics.length > 0
        ? `Another nearby turn from ${trackInfo.title}. ${metrics.join(" / ")} on Last.fm.`
        : `Another similar track Last.fm surfaced for ${trackInfo.title}.`,
    item.image_url ?? trackInfo.album_art
  ));
}

function buildAlbumCards(
  trackInfo: TrackInfo,
  normalizedTrack: NormalizedTrackMetadata,
  context: LastfmContext | null,
  mood: string,
  status: "idle" | "loading" | "ready" | "error",
  errorMessage: string | null
): DeckCard[] {
  if (status === "loading") {
    return [createSingleCard(
      "albums-loading",
      "Similar albums",
      "Mapping the artist lane",
      normalizedTrack.displayArtist,
      ["Last.fm", "Albums"],
      "Looking up the strongest album picks around the current artist.",
      trackInfo.album_art
    )];
  }

  if (status === "error") {
    return [createSingleCard(
      "albums-error",
      "Similar albums",
      "Album lane unavailable",
      normalizedTrack.displayArtist,
      ["Last.fm", mood],
      errorMessage ?? "Last.fm could not return album context for this artist.",
      trackInfo.album_art
    )];
  }

  if (!context || context.top_albums.length === 0) {
    return [createSingleCard(
      "albums-empty",
      "Similar albums",
      "No album picks surfaced",
      normalizedTrack.displayArtist,
      ["Last.fm", mood],
      "Last.fm did not return additional album context for this artist.",
      trackInfo.album_art
    )];
  }

  return context.top_albums.map((item, index) => {
    const albumBadge = item.rank ? `Top ${item.rank}` : "Album pick";
    const listeners = formatMetric(item.listeners, "plays");

    return createSingleCard(
      `albums-${index}-${item.artist}-${item.name}`,
      "Similar albums",
      item.name,
      item.artist,
      [albumBadge, ...(listeners ? [listeners] : [mood])],
      index === 0
        ? "Using Last.fm artist album data while queue integrations stay parked for now."
        : `Another album lane around ${normalizedTrack.displayArtist} from Last.fm.`,
      item.image_url ?? trackInfo.album_art
    );
  });
}

function buildQueueCard(trackInfo: TrackInfo, normalizedTrack: NormalizedTrackMetadata, mood: string): DeckCard {
  return createSingleCard(
    "queue",
    "Queue",
    "Queue is parked for now",
    trackInfo.title
      ? `${normalizedTrack.displayArtist} / ${trackInfo.title}`
      : "Waiting for player integrations",
    ["Unused", mood],
    "We are not wiring Apple Music or Spotify yet, so this tab stays informational only.",
    trackInfo.album_art
  );
}

function isEditableElement(element: Element | null): boolean {
  return element instanceof HTMLElement
    && (element.tagName === "INPUT"
      || element.tagName === "TEXTAREA"
      || element.tagName === "SELECT"
      || element.isContentEditable);
}

function renderSwipeCard(card: DeckCard, tabClassName: string, role: "left" | "center" | "right") {
  const isPreview = role !== "center";

  return (
    <div
      className={`swipe-card ${tabClassName} ${role} ${isPreview ? "preview" : "center"}`}
      aria-hidden={isPreview}
    >
      <div className="album-art album-art-large">
        {card.imageSrc ? (
          <img
            src={card.imageSrc}
            alt=""
            className="album-art-inner album-art-image"
            decoding="async"
          />
        ) : (
          <div className="album-art-inner" />
        )}
      </div>
      <div className="swipe-card-content">
        <span className="swipe-card-eyebrow">{card.eyebrow}</span>
        <h3 className="swipe-card-title">{card.title}</h3>
        <p className="swipe-card-artist">{card.subtitle}</p>
        <div className="badges">
          {card.badges.map((badge, index) => (
            <span key={`${card.key}-${badge}-${index}`} className={`badge ${index === 0 ? "primary" : "secondary"}`}>
              {badge}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("Discover");
  const [trackInfo, setTrackInfo] = useState<TrackInfo>(NEUTRAL_TRACK);
  const [accentTheme, setAccentTheme] = useState<AccentTheme>(() => createThemeFromHex(NEUTRAL_ACCENT, true));
  const [lastfmContext, setLastfmContext] = useState<LastfmContext | null>(null);
  const [lastfmStatus, setLastfmStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [lastfmError, setLastfmError] = useState<string | null>(null);
  const [discoverCardIndex, setDiscoverCardIndex] = useState(0);
  const [albumCardIndex, setAlbumCardIndex] = useState(0);
  const [laneMotion, setLaneMotion] = useState<{ tab: LaneTab; direction: LaneMotionDirection } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [windowVisible, setWindowVisible] = useState(true);
  const shortcutsAreaRef = useRef<HTMLDivElement>(null);
  const shortcutsRef = useRef<HTMLDivElement>(null);
  const lastfmCacheRef = useRef<Map<string, LastfmContext>>(new Map());
  const laneMotionTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const idleState = isNeutralTrack(trackInfo);
  const normalizedTrack = normalizeTrackMetadata(trackInfo);
  const lookupKey = buildLookupKey(normalizedTrack);
  const discoverCards = idleState
    ? [buildIdleCard("Discover", accentTheme.mood)]
    : buildDiscoverCards(
      trackInfo,
      normalizedTrack,
      lastfmContext,
      accentTheme.mood,
      lastfmStatus,
      lastfmError
    );
  const albumCards = idleState
    ? [buildIdleCard("Similar albums", accentTheme.mood)]
    : buildAlbumCards(
      trackInfo,
      normalizedTrack,
      lastfmContext,
      accentTheme.mood,
      lastfmStatus,
      lastfmError
    );
  const queueCard = idleState
    ? buildIdleCard("Queue", accentTheme.mood)
    : buildQueueCard(trackInfo, normalizedTrack, accentTheme.mood);
  const discoverCardsKey = discoverCards.map((card) => card.key).join("\u241f");
  const albumCardsKey = albumCards.map((card) => card.key).join("\u241f");
  const activeCards = activeTab === "Discover"
    ? discoverCards
    : activeTab === "Similar albums"
      ? albumCards
      : [queueCard];
  const activeIndex = activeTab === "Discover"
    ? clamp(discoverCardIndex, 0, Math.max(discoverCards.length - 1, 0))
    : activeTab === "Similar albums"
      ? clamp(albumCardIndex, 0, Math.max(albumCards.length - 1, 0))
      : 0;
  const centerCard = activeCards[activeIndex] ?? queueCard;
  const leftPreviewCard = activeTab !== "Queue" && activeIndex > 0
    ? activeCards[activeIndex - 1]
    : null;
  const rightPreviewCard = activeTab !== "Queue" && activeIndex < activeCards.length - 1
    ? activeCards[activeIndex + 1]
    : null;
  const stackedLaneEnabled = activeTab !== "Queue" && activeCards.length > 1;
  const laneMotionClass = laneMotion && laneMotion.tab === activeTab
    ? `lane-${laneMotion.direction}`
    : "";

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
    root.style.setProperty("--btn-hover-bg", accentTheme.btnHoverBg);
    root.style.setProperty("--btn-hover-border", accentTheme.btnHoverBorder);
    root.style.setProperty("--btn-hover-shadow", accentTheme.btnHoverShadow);
    root.style.setProperty("--ctrl-hover-border", accentTheme.ctrlHoverBorder);
    root.style.setProperty("--card-bg", accentTheme.cardBg);
  }, [accentTheme]);

  useEffect(() => {
    let cancelled = false;
    const fallback = idleState ? NEUTRAL_ACCENT : LIVE_FALLBACK_ACCENT;

    const applyTheme = (primary: RGB, secondary: RGB) => {
      if (!cancelled) {
        setAccentTheme(buildAccentTheme(primary, secondary, idleState));
      }
    };

    if (trackInfo.album_art) {
      extractColours(trackInfo.album_art)
        .then(([primary, secondary]) => applyTheme(primary, secondary))
        .catch(() => applyTheme(hexToRgb(fallback[0]), hexToRgb(fallback[1])));
    } else {
      applyTheme(hexToRgb(fallback[0]), hexToRgb(fallback[1]));
    }

    return () => {
      cancelled = true;
    };
  }, [idleState, trackInfo.album_art]);

  useEffect(() => {
    if (idleState || !normalizedTrack.lookupTitle.trim() || !normalizedTrack.lookupArtist.trim()) {
      setLastfmContext(null);
      setLastfmStatus("idle");
      setLastfmError(null);
      return;
    }

    const cached = lastfmCacheRef.current.get(lookupKey);
    if (cached) {
      setLastfmContext(cached);
      setLastfmStatus("ready");
      setLastfmError(null);
      return;
    }

    let cancelled = false;
    setLastfmStatus("loading");
    setLastfmError(null);

    invoke<LastfmContext>("lookup_lastfm_context", {
      artist: normalizedTrack.lookupArtist,
      track: normalizedTrack.lookupTitle,
      albumTitle: normalizedTrack.displayAlbum || null
    })
      .then((result) => {
        if (cancelled) return;
        lastfmCacheRef.current.set(lookupKey, result);
        setLastfmContext(result);
        setLastfmStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setLastfmContext(null);
        setLastfmStatus("error");
        setLastfmError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [idleState, lookupKey, normalizedTrack.displayAlbum, normalizedTrack.lookupArtist, normalizedTrack.lookupTitle]);

  useEffect(() => {
    setDiscoverCardIndex(0);
  }, [discoverCardsKey, lookupKey]);

  useEffect(() => {
    setAlbumCardIndex(0);
  }, [albumCardsKey, lookupKey]);

  useEffect(() => () => {
    if (laneMotionTimeoutRef.current !== null) {
      window.clearTimeout(laneMotionTimeoutRef.current);
    }
  }, []);

  // Preload deck images ahead of swipe to prevent art popping
  useEffect(() => {
    if (!lastfmContext) return;

    const timeoutId = window.setTimeout(() => {
      const preloadUrls = new Set<string>();

      lastfmContext.similar_tracks.forEach((track) => {
        if (track.image_url) preloadUrls.add(track.image_url);
      });

      lastfmContext.top_albums.forEach((album) => {
        if (album.image_url) preloadUrls.add(album.image_url);
      });

      preloadUrls.forEach((url) => {
        const img = new Image();
        img.decoding = "async";
        img.src = url;
      });
    }, 150);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [lastfmContext]);

  const handlePlayPause = useCallback(async () => {
    try {
      await invoke("toggle_playback");
    } catch (error) {
      console.error("Failed to toggle playback:", error);
    }
  }, []);

  const handleSkipNext = useCallback(async () => {
    try {
      await invoke("skip_next");
    } catch (error) {
      console.error("Failed to skip next:", error);
    }
  }, []);

  const handleSkipPrevious = useCallback(async () => {
    try {
      await invoke("skip_previous");
    } catch (error) {
      console.error("Failed to skip previous:", error);
    }
  }, []);

  const triggerLaneMotion = useCallback((tab: LaneTab, direction: LaneMotionDirection) => {
    if (laneMotionTimeoutRef.current !== null) {
      window.clearTimeout(laneMotionTimeoutRef.current);
    }

    setLaneMotion({ tab, direction });
    laneMotionTimeoutRef.current = window.setTimeout(() => {
      setLaneMotion(null);
      laneMotionTimeoutRef.current = null;
    }, 280);
  }, []);

  const navigateLane = useCallback((tab: LaneTab, direction: -1 | 1) => {
    const motionDirection: LaneMotionDirection = direction === 1 ? "forward" : "backward";

    if (tab === "Discover") {
      const nextIndex = clamp(discoverCardIndex + direction, 0, Math.max(discoverCards.length - 1, 0));
      if (nextIndex === discoverCardIndex) return;
      setDiscoverCardIndex(nextIndex);
      triggerLaneMotion(tab, motionDirection);
      return;
    }

    const nextIndex = clamp(albumCardIndex + direction, 0, Math.max(albumCards.length - 1, 0));
    if (nextIndex === albumCardIndex) return;
    setAlbumCardIndex(nextIndex);
    triggerLaneMotion(tab, motionDirection);
  }, [albumCardIndex, albumCards.length, discoverCardIndex, discoverCards.length, triggerLaneMotion]);

  useEffect(() => {
    const handleKeyDown = async (event: KeyboardEvent) => {
      const lowerKey = event.key.toLowerCase();
      const typingInEditable = isEditableElement(document.activeElement);

      if (event.key === "Escape") {
        setShowShortcuts(false);
        setWindowVisible(false);
        await getCurrentWindow().hide();
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleSkipPrevious();
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        handleSkipNext();
      }

      if (event.key === " " && !event.shiftKey && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        handlePlayPause();
      }

      if (
        !typingInEditable
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
        && lowerKey === "o"
      ) {
        event.preventDefault();
        setShowShortcuts((previous) => !previous);
      }

      if (
        !typingInEditable
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
        && (lowerKey === "j" || lowerKey === "l")
      ) {
        if (activeTab === "Discover" && discoverCards.length > 1) {
          event.preventDefault();
          navigateLane("Discover", lowerKey === "j" ? -1 : 1);
        }

        if (activeTab === "Similar albums" && albumCards.length > 1) {
          event.preventDefault();
          navigateLane("Similar albums", lowerKey === "j" ? -1 : 1);
        }
      }

      if (event.key === "1") {
        event.preventDefault();
        setActiveTab("Discover");
      }

      if (event.key === "2") {
        event.preventDefault();
        setActiveTab("Similar albums");
      }

      /* Hidden until integration
      if (event.key === "3") {
        event.preventDefault();
        setActiveTab("Queue");
      }
      */
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (shortcutsAreaRef.current && !shortcutsAreaRef.current.contains(event.target as Node)) {
        setShowShortcuts(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [activeTab, albumCards.length, discoverCards.length, handlePlayPause, handleSkipNext, handleSkipPrevious, navigateLane]);

  useEffect(() => {
    const unlisten = listen<TrackInfo>("smtc-update", (event) => {
      setTrackInfo((previous) => {
        const next = event.payload;

        if (
          !isNeutralTrack(next) &&
          !next.album_art &&
          previous.album_art &&
          next.title === previous.title &&
          next.artist === previous.artist &&
          next.album_title === previous.album_title
        ) {
          return { ...next, album_art: previous.album_art };
        }

        return next;
      });
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  // Track window visibility so we can halt all GPU-intensive rendering
  // (animations, compositing) when the overlay is hidden.
  useEffect(() => {
    const unlisten = listen<boolean>("window-visibility", (event) => {
      setWindowVisible(event.payload);
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  const progressPercent = trackInfo.duration > 0
    ? (trackInfo.position / trackInfo.duration) * 100
    : 0;

  const trackTitle = idleState ? "Nothing playing" : trackInfo.title;
  const trackSubtitle = idleState
    ? "Waiting for a music stream"
    : [normalizedTrack.displayArtist || "Unknown artist", normalizedTrack.displayAlbum].filter(Boolean).join(" / ");
  const statusLabel = idleState ? "Ready" : trackInfo.status;
  const tabClassName = activeTab.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className={`container ${idleState ? "is-idle" : ""}${!windowVisible ? " is-hidden" : ""}`}>
      <AmbientBackground
        accent1={accentTheme.accent1}
        accent2={accentTheme.accent2}
        idle={idleState}
        hidden={!windowVisible}
      />

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
              onClick={() => setShowShortcuts((previous) => !previous)}
            >
              <Settings size={18} />
            </button>

            <div className={`shortcuts-dropdown-wrapper ${showShortcuts ? "visible" : ""}`}>
              <div className="shortcuts-dropdown" ref={shortcutsRef}>
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
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="main-content">
        <div className="now-playing-card">
          <div className="album-art">
            {trackInfo.album_art ? (
              <img
                key={trackInfo.album_art}
                src={trackInfo.album_art}
                alt="Album art"
                className="album-art-inner album-art-image"
                decoding="async"
              />
            ) : (
              <div className="album-art-inner" />
            )}
          </div>
          <div className="track-info">
            <h2 className="track-title">{trackTitle}</h2>
            <p className="track-artist">{trackSubtitle}</p>
            <div className="track-meta">
              <div className="badges">
                <span className={`badge active ${idleState ? "idle" : ""}`}>{statusLabel}</span>
                <span className="badge mood">{accentTheme.mood}</span>
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
            <button className="playback-control-btn" onClick={handleSkipPrevious} type="button">
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button className="play-pause-btn" onClick={handlePlayPause} type="button">
              {trackInfo.status === "Playing"
                ? <Pause size={22} fill="currentColor" />
                : <Play size={22} fill="currentColor" />}
            </button>
            <button className="playback-control-btn" onClick={handleSkipNext} type="button">
              <SkipForward size={18} fill="currentColor" />
            </button>
          </div>
        </div>

        <div className="tabs">
          {APP_TABS.filter(tab => tab !== "Queue").map((tab) => (
            <div
              key={tab}
              className={`tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </div>
          ))}
        </div>

        <div className="deck-container">
          <div className={`swipe-card-area ${stackedLaneEnabled ? "stacked" : "single"}`}>
            <div className={`swipe-card-stack ${stackedLaneEnabled ? "stacked" : "single"} ${laneMotionClass}`.trim()}>
              {leftPreviewCard && (
                <div key={`left-${leftPreviewCard.key}`} className="swipe-card-slot left" aria-hidden="true">
                  {renderSwipeCard(leftPreviewCard, tabClassName, "left")}
                </div>
              )}
              <div className="swipe-card-slot center">
                <div key={`${activeTab}-${centerCard.key}`} className="swipe-card-stage center">
                  {renderSwipeCard(centerCard, tabClassName, "center")}
                </div>
              </div>
              {rightPreviewCard && (
                <div key={`right-${rightPreviewCard.key}`} className="swipe-card-slot right" aria-hidden="true">
                  {renderSwipeCard(rightPreviewCard, tabClassName, "right")}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="footer">
        <div>Alt+W to open</div>
        <div className="footer-icon">
          <PlusCircle size={14} /> Last.fm live data
        </div>
      </div>
    </div>
  );
}

export default App;
