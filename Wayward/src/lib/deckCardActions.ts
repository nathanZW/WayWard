import { openUrl } from "@tauri-apps/plugin-opener";
import type { DeckCard } from "../types/domain";

function getCardActionText(card: DeckCard): string {
  return [card.title, card.subtitle]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");
}

function getCardSearchText(card: DeckCard, sourcePlayer: string): string {
  return [getCardActionText(card), sourcePlayer.trim()]
    .filter(Boolean)
    .join(" ");
}

export async function copyDeckCard(card: DeckCard): Promise<void> {
  const text = getCardActionText(card);
  if (!text) return;
  await navigator.clipboard.writeText(text);
}

export async function searchDeckCard(card: DeckCard, sourcePlayer = ""): Promise<void> {
  const query = getCardSearchText(card, sourcePlayer);
  if (!query) return;

  const searchUrl = new URL("https://www.google.com/search");
  searchUrl.searchParams.set("q", query);
  await openUrl(searchUrl);
}
