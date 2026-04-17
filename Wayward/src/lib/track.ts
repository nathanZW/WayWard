import type {
  AppTab,
  DeckCard,
  DeckModel,
  LastfmContext,
  LastfmStatus,
  NormalizedTrackMetadata,
  TrackInfo
} from "../types/domain";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isNeutralTrack(track: Pick<TrackInfo, "title" | "artist" | "album_title" | "album_art" | "duration">): boolean {
  return !track.title.trim()
    && !track.artist.trim()
    && !track.album_title.trim()
    && !track.album_art
    && track.duration <= 0;
}

export function formatTime(secs: number): string {
  if (secs <= 0 || !Number.isFinite(secs)) return "0:00";
  const totalSeconds = Math.round(secs);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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

const compactMetricFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1
});

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

export function normalizeTrackMetadata(trackInfo: Pick<TrackInfo, "title" | "artist" | "album_artist" | "album_title">): NormalizedTrackMetadata {
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

export function buildLookupKey(normalizedTrack: NormalizedTrackMetadata): string {
  return [normalizedTrack.lookupTitle, normalizedTrack.lookupArtist, normalizedTrack.displayAlbum]
    .map((value) => value.trim().toLowerCase())
    .join("\u241f");
}

function formatMetric(value: string | null | undefined, label: string): string | null {
  if (!value) return null;
  const normalized = Number.parseInt(value.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(normalized)) return null;

  return `${compactMetricFormatter.format(normalized)} ${label}`;
}

function createCard(
  key: string,
  eyebrow: string,
  title: string,
  subtitle: string,
  badges: string[],
  imageSrc: string | null
): DeckCard {
  return { key, eyebrow, title, subtitle, badges, imageSrc };
}

function buildIdleCard(tab: AppTab, mood: string): DeckCard {
  return createCard(
    `${tab}-idle`,
    tab,
    tab === "Queue"
      ? "Queue is parked until integrations land"
      : "Start Apple Music, Amazon Music, Spotify, TIDAL, Deezer, or YouTube Music",
    "Wayward is standing by for a supported music app.",
    [mood, "Standby"],
    null
  );
}

function buildDiscoverCards(
  trackInfo: Pick<TrackInfo, "title" | "album_art">,
  normalizedTrack: NormalizedTrackMetadata,
  context: LastfmContext | null,
  mood: string,
  status: LastfmStatus
): DeckCard[] {
  if (status === "loading") {
    return [createCard(
      "discover-loading",
      "Discover",
      "Finding a nearby left turn",
      `${normalizedTrack.displayArtist} / ${trackInfo.title}`,
      ["Last.fm", "Scanning"],
      trackInfo.album_art
    )];
  }

  if (status === "error") {
    return [createCard(
      "discover-error",
      "Discover",
      "No Last.fm match yet",
      `${normalizedTrack.displayArtist} / ${trackInfo.title}`,
      ["Last.fm", mood],
      trackInfo.album_art
    )];
  }

  if (!context || context.similar_tracks.length === 0) {
    return [createCard(
      "discover-empty",
      "Discover",
      "No similar tracks surfaced",
      `${normalizedTrack.displayArtist} / ${trackInfo.title}`,
      ["Last.fm", mood],
      trackInfo.album_art
    )];
  }

  const metrics = [
    formatMetric(context.source.listeners, "listeners"),
    formatMetric(context.source.playcount, "plays")
  ].filter(Boolean) as string[];
  const badges = context.source.tags.slice(0, 2);

  return context.similar_tracks.map((item, index) => createCard(
    `discover-${index}-${item.artist}-${item.name}`,
    "Discover",
    item.name,
    [item.artist, item.album].filter(Boolean).join(" / "),
    index === 0
      ? (badges.length > 0 ? badges : ["Last.fm", mood])
      : (metrics.length > 0 ? metrics : [mood, "Last.fm"]),
    item.image_url ?? trackInfo.album_art
  ));
}

function buildAlbumCards(
  trackInfo: Pick<TrackInfo, "album_art">,
  normalizedTrack: NormalizedTrackMetadata,
  context: LastfmContext | null,
  mood: string,
  status: LastfmStatus
): DeckCard[] {
  if (status === "loading") {
    return [createCard(
      "albums-loading",
      "Similar albums",
      "Mapping the artist lane",
      normalizedTrack.displayArtist,
      ["Last.fm", "Albums"],
      trackInfo.album_art
    )];
  }

  if (status === "error") {
    return [createCard(
      "albums-error",
      "Similar albums",
      "Album lane unavailable",
      normalizedTrack.displayArtist,
      ["Last.fm", mood],
      trackInfo.album_art
    )];
  }

  if (!context || context.top_albums.length === 0) {
    return [createCard(
      "albums-empty",
      "Similar albums",
      "No album picks surfaced",
      normalizedTrack.displayArtist,
      ["Last.fm", mood],
      trackInfo.album_art
    )];
  }

  return context.top_albums.map((item, index) => {
    const albumBadge = item.rank ? `Top ${item.rank}` : "Album pick";
    const listeners = formatMetric(item.listeners, "plays");

    return createCard(
      `albums-${index}-${item.artist}-${item.name}`,
      "Similar albums",
      item.name,
      item.artist,
      [albumBadge, ...(listeners ? [listeners] : [mood])],
      item.image_url ?? trackInfo.album_art
    );
  });
}

function buildQueueCard(
  trackInfo: Pick<TrackInfo, "title" | "album_art">,
  normalizedTrack: NormalizedTrackMetadata,
  mood: string
): DeckCard {
  return createCard(
    "queue",
    "Queue",
    "Queue is parked for now",
    trackInfo.title
      ? `${normalizedTrack.displayArtist} / ${trackInfo.title}`
      : "Waiting for player integrations",
    ["Unused", mood],
    trackInfo.album_art
  );
}

export interface DeckModelInput {
  trackInfo: Pick<TrackInfo, "title" | "artist" | "album_artist" | "album_title" | "album_art" | "duration">;
  lastfmContext: LastfmContext | null;
  lastfmStatus: LastfmStatus;
  activeTab: AppTab;
  discoverCardIndex: number;
  albumCardIndex: number;
  mood: string;
}

export function buildDeckModel(input: DeckModelInput): DeckModel {
  const normalizedTrack = normalizeTrackMetadata(input.trackInfo);
  const lookupKey = buildLookupKey(normalizedTrack);
  const idleState = isNeutralTrack(input.trackInfo);
  const discoverCards = idleState
    ? [buildIdleCard("Discover", input.mood)]
    : buildDiscoverCards(input.trackInfo, normalizedTrack, input.lastfmContext, input.mood, input.lastfmStatus);
  const albumCards = idleState
    ? [buildIdleCard("Similar albums", input.mood)]
    : buildAlbumCards(input.trackInfo, normalizedTrack, input.lastfmContext, input.mood, input.lastfmStatus);
  const queueCard = idleState
    ? buildIdleCard("Queue", input.mood)
    : buildQueueCard(input.trackInfo, normalizedTrack, input.mood);
  const discoverCardsKey = discoverCards.map((card) => card.key).join("\u241f");
  const albumCardsKey = albumCards.map((card) => card.key).join("\u241f");
  const activeCards = input.activeTab === "Discover"
    ? discoverCards
    : input.activeTab === "Similar albums"
      ? albumCards
      : [queueCard];
  const activeIndex = input.activeTab === "Discover"
    ? clamp(input.discoverCardIndex, 0, Math.max(discoverCards.length - 1, 0))
    : input.activeTab === "Similar albums"
      ? clamp(input.albumCardIndex, 0, Math.max(albumCards.length - 1, 0))
      : 0;
  const centerCard = activeCards[activeIndex] ?? queueCard;
  const leftPreviewCard = input.activeTab !== "Queue" && activeIndex > 0
    ? activeCards[activeIndex - 1]
    : null;
  const rightPreviewCard = input.activeTab !== "Queue" && activeIndex < activeCards.length - 1
    ? activeCards[activeIndex + 1]
    : null;

  return {
    normalizedTrack,
    lookupKey,
    discoverCards,
    albumCards,
    queueCard,
    discoverCardsKey,
    albumCardsKey,
    activeCards,
    activeIndex,
    centerCard,
    leftPreviewCard,
    rightPreviewCard,
    stackedLaneEnabled: input.activeTab !== "Queue" && activeCards.length > 1
  };
}
