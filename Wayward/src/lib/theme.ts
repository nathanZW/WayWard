import {
  LIVE_FALLBACK_ACCENT,
  NEUTRAL_ACCENT,
  type AccentTheme,
  type BadgeStyle,
  type ColourAnalysis,
  type ExtractedPalette,
  type HSL,
  type RGB
} from "../types/domain";

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
const MOOD_IDLE_LABEL = "Soft focus";
const MOOD_SHADOW_LUMINANCE_MAX = 0.2;
const MOOD_DARK_LUMINANCE_MAX = 0.28;
const MOOD_BRIGHT_LUMINANCE_MIN = 0.56;
const MOOD_MUTED_SATURATION_MAX = 0.18;
const MOOD_VIBRANT_SATURATION_MIN = 0.46;
const MOOD_BRIGHT_SATURATION_MIN = 0.34;
const MOOD_VIVID_SATURATION_MIN = 0.58;
const MOOD_MID_BRIGHTNESS_MIN = 0.34;
const MOOD_MID_BRIGHTNESS_MAX = 0.54;
const MOOD_WARMTH_MIN = 0.12;
const MOOD_COOLNESS_MAX = -0.06;
const MOOD_WARM_HUE_MIN = 18;
const MOOD_WARM_HUE_MAX = 72;
const MOOD_COOL_HUE_MIN = 185;
const MOOD_COOL_HUE_MAX = 255;
const MOOD_HUE_SEPARATION_MIN = 72;
const MOOD_DUAL_TONE_SATURATION_MIN = 0.38;

let paletteContext: CanvasRenderingContext2D | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hexToRgb(hex: string): RGB {
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

function isWarmHue(hue: number): boolean {
  return hue >= MOOD_WARM_HUE_MIN && hue <= MOOD_WARM_HUE_MAX;
}

function isCoolHue(hue: number): boolean {
  return hue >= MOOD_COOL_HUE_MIN && hue <= MOOD_COOL_HUE_MAX;
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

function describeMood(primary: RGB, secondary: RGB, analysis: ColourAnalysis | null, idle: boolean): string {
  if (idle) return MOOD_IDLE_LABEL;

  const primaryHsl = rgbToHsl(primary);
  const secondaryHsl = rgbToHsl(secondary);
  const primaryWarmth = getWarmth(primary);
  const secondaryWarmth = getWarmth(secondary);
  const averageWarmth = (primaryWarmth + secondaryWarmth) / 2;
  const averageSaturation = analysis?.weightedAverageSaturation ?? ((primaryHsl.s + secondaryHsl.s) / 2);
  const averageBrightness = analysis
    ? analysis.averageBrightness / 255
    : (primaryHsl.l + secondaryHsl.l) / 2;
  const hueDistance = getHueDistance(primaryHsl.h, secondaryHsl.h);
  const warmHue = isWarmHue(primaryHsl.h) || isWarmHue(secondaryHsl.h);
  const coolHue = isCoolHue(primaryHsl.h) || isCoolHue(secondaryHsl.h);
  const warmTone = warmHue || averageWarmth >= MOOD_WARMTH_MIN;
  const coolTone = coolHue || averageWarmth <= MOOD_COOLNESS_MAX;

  if (averageSaturation >= MOOD_VIBRANT_SATURATION_MIN && averageBrightness <= MOOD_DARK_LUMINANCE_MAX) {
    if (hueDistance >= MOOD_HUE_SEPARATION_MIN) return "Neon";
    return warmTone ? "Fired Up" : "Wired";
  }

  if (averageSaturation >= MOOD_BRIGHT_SATURATION_MIN && averageBrightness >= MOOD_BRIGHT_LUMINANCE_MIN) {
    if (hueDistance >= MOOD_HUE_SEPARATION_MIN) return "Pop";
    if (warmTone && averageSaturation < MOOD_VIVID_SATURATION_MIN) return "Bright Side";
    if (!warmTone && averageSaturation >= MOOD_VIVID_SATURATION_MIN) return "Vivid";
    return warmTone ? "Bright Side" : "Vivid";
  }

  if (averageSaturation <= MOOD_MUTED_SATURATION_MAX) {
    if (averageBrightness >= MOOD_BRIGHT_LUMINANCE_MIN) {
      return coolTone ? "Cool Down" : "Open";
    }

    if (averageBrightness <= MOOD_SHADOW_LUMINANCE_MAX) {
      return coolTone ? "After Dark" : "Wind Down";
    }

    return warmTone ? "Easy" : "Soft";
  }

  if (averageBrightness <= MOOD_SHADOW_LUMINANCE_MAX) {
    return coolTone ? "After Dark" : "Wind Down";
  }

  if (warmTone && averageBrightness >= MOOD_MID_BRIGHTNESS_MIN && averageBrightness <= MOOD_MID_BRIGHTNESS_MAX) {
    return "Easy";
  }

  if (coolTone && averageBrightness <= MOOD_BRIGHT_LUMINANCE_MIN) {
    return "Cool Down";
  }

  if (hueDistance >= MOOD_HUE_SEPARATION_MIN && averageSaturation >= MOOD_DUAL_TONE_SATURATION_MIN) {
    return "Pop";
  }

  return averageBrightness >= MOOD_BRIGHT_LUMINANCE_MIN ? "Bright Side" : "After Dark";
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

export function buildAccentTheme(primaryInput: RGB, secondaryInput: RGB, analysis: ColourAnalysis | null, idle: boolean): AccentTheme {
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
    mood: describeMood(primary, secondary, analysis, idle),
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

export function createThemeFromHex(accents: [string, string], idle: boolean): AccentTheme {
  return buildAccentTheme(hexToRgb(accents[0]), hexToRgb(accents[1]), null, idle);
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

export function extractColours(src: string): Promise<ExtractedPalette> {
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
        resolve({
          primary: fallback[0],
          secondary: fallback[1],
          analysis: null
        });
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
      let weightSum = 0;
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
        weightSum += weight;
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
        resolve({
          primary: fallback[0],
          secondary: fallback[1],
          analysis: null
        });
        return;
      }

      const analysis: ColourAnalysis = {
        totalPixels: data.length / 4,
        sampledPixels: acceptedPixels + rejectedPixels,
        acceptedPixels,
        rejectedPixels,
        rejectionRate: rejectedPixels / Math.max(acceptedPixels + rejectedPixels, 1),
        averageSaturation: saturationSum / Math.max(acceptedPixels, 1),
        weightedAverageSaturation: weightedSaturationSum / Math.max(weightSum, 1),
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

      resolve({
        primary,
        secondary,
        analysis
      });
    };

    image.onerror = () => resolve({
      primary: fallback[0],
      secondary: fallback[1],
      analysis: null
    });
    image.src = src;
  });
}

export function getThemeFallback(idle: boolean): [string, string] {
  return idle ? NEUTRAL_ACCENT : LIVE_FALLBACK_ACCENT;
}
