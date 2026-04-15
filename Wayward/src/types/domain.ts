export interface TrackInfo {
  title: string;
  artist: string;
  album_artist: string;
  album_title: string;
  status: string;
  position: number;
  duration: number;
  album_art: string | null;
}

export interface LastfmSource {
  url: string | null;
  listeners: string | null;
  playcount: string | null;
  tags: string[];
}

export interface LastfmTrackMatch {
  name: string;
  artist: string;
  album: string | null;
  image_url: string | null;
  url: string | null;
  match_score: number | null;
}

export interface LastfmAlbumMatch {
  name: string;
  artist: string;
  image_url: string | null;
  url: string | null;
  listeners: string | null;
  rank: number | null;
}

export interface LastfmContext {
  source: LastfmSource;
  similar_tracks: LastfmTrackMatch[];
  top_albums: LastfmAlbumMatch[];
}

export type LastfmStatus = "idle" | "loading" | "ready" | "error";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ColourBucketAnalysis {
  colour: RGB;
  score: number;
  saturation: number;
  brightness: number;
}

export interface ColourAnalysis {
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

export interface ExtractedPalette {
  primary: RGB;
  secondary: RGB;
  analysis: ColourAnalysis | null;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export interface BadgeStyle {
  background: string;
  border: string;
  shadow: string;
}

export interface AccentTheme {
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

export interface DeckCard {
  key: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  badges: string[];
  imageSrc: string | null;
}

export interface NormalizedTrackMetadata {
  lookupTitle: string;
  lookupArtist: string;
  displayArtist: string;
  displayAlbum: string;
}

export const APP_TABS = ["Discover", "Similar albums", "Queue"] as const;
export type AppTab = typeof APP_TABS[number];
export type LaneTab = Extract<AppTab, "Discover" | "Similar albums">;
export type LaneMotionDirection = "forward" | "backward";

export interface LaneMotionState {
  tab: LaneTab;
  direction: LaneMotionDirection;
}

export interface DeckModel {
  normalizedTrack: NormalizedTrackMetadata;
  lookupKey: string;
  discoverCards: DeckCard[];
  albumCards: DeckCard[];
  queueCard: DeckCard;
  discoverCardsKey: string;
  albumCardsKey: string;
  activeCards: DeckCard[];
  activeIndex: number;
  centerCard: DeckCard;
  leftPreviewCard: DeckCard | null;
  rightPreviewCard: DeckCard | null;
  stackedLaneEnabled: boolean;
}

export const NEUTRAL_TRACK: TrackInfo = {
  title: "",
  artist: "",
  album_artist: "",
  album_title: "",
  status: "Idle",
  position: 0,
  duration: 0,
  album_art: null
};

export const NEUTRAL_ACCENT: [string, string] = ["#f2ede4", "#d7d1c8"];
export const LIVE_FALLBACK_ACCENT: [string, string] = ["#8b5cf6", "#ec4899"];
