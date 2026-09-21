import { supabase } from "@/integrations/supabase/client";
import { normalize, similarity } from "./match";

type ChoiceTrack = { title: string; artist: string };

const label = (t: ChoiceTrack) => `${t.title} — ${t.artist}`;

/**
 * Builds 4 multiple-choice options: the right answer plus plausible wrong ones
 * taken from the same playlists (same artist first, then similar-sounding titles),
 * never a duplicate or a different version of the same song.
 */
export function buildChoiceOptions(correct: ChoiceTrack, pool: ChoiceTrack[]): string[] {
  const correctTitle = normalize(correct.title);
  const correctArtist = normalize(correct.artist);
  const seen = new Set([label(correct).toLowerCase(), correctTitle]);

  const candidates: { text: string; score: number }[] = [];
  for (const other of pool) {
    const title = normalize(other.title);
    const artist = normalize(other.artist);
    if (!title) continue;
    // Skip the same song (or another version of it).
    if (title === correctTitle || similarity(title, correctTitle) >= 0.8) continue;
    const text = label(other);
    const key = text.toLowerCase();
    if (seen.has(key) || seen.has(title)) continue;
    seen.add(key);
    seen.add(title);

    const sameArtist = artist === correctArtist ? 1 : similarity(artist, correctArtist) >= 0.85 ? 0.9 : 0;
    const titleLike = similarity(title, correctTitle); // < 0.8 by now
    const lengthLike = 1 - Math.min(1, Math.abs(title.length - correctTitle.length) / 24);
    candidates.push({
      text,
      score: sameArtist * 2 + titleLike * 1.2 + lengthLike * 0.6 + Math.random() * 0.5,
    });
  }

  const wrong = candidates.sort((a, b) => b.score - a.score).slice(0, 3).map((c) => c.text);
  return shuffle([label(correct), ...wrong]);
}

export type GameMode = "type" | "choice" | "owner" | "tries" | "chronology" | "blend";

export type RoomRow = {
  id: string;
  code: string;
  host_key: string;
  playlist_name: string;
  playlist_image: string | null;
  tracks: { title: string; artist: string; cover: string | null; releaseDate?: string }[];
  rounds: number;
  seconds: number;
  mode: string;
  status: string;
  current_round: number;
  round_started_at: string | null;
  team_battle: boolean;
};

export type PlayerRow = {
  id: string;
  room_id: string;
  name: string;
  client_key: string;
  score: number;
  is_host: boolean;
  playlist_name: string;
  playlist_tracks: { title: string; artist: string; cover: string | null; releaseDate?: string }[];
  team: string | null;
  created_at: string;
};

export type RoundTrackRow = {
  id: string;
  room_id: string;
  idx: number;
  title: string;
  artist: string;
  preview_url: string;
  cover: string | null;
  options: string[];
  source_player_name: string | null;
};

export type GuessRow = {
  id: string;
  room_id: string;
  round_idx: number;
  player_id: string;
  answer: string;
  correct_title: boolean;
  correct_artist: boolean;
  points: number;
  created_at: string;
};

const KEY = "blindbeat.client-key";
const NAME = "blindbeat.name";

export function getClientKey(): string {
  if (typeof window === "undefined") return "";
  let key = window.localStorage.getItem(KEY);
  if (!key) {
    key = crypto.randomUUID();
    window.localStorage.setItem(KEY, key);
  }
  return key;
}

export function getSavedName(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(NAME) ?? "";
}

export function saveName(name: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(NAME, name);
}

export function makeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export function computeRoundPoints({
  titleCorrect,
  artistCorrect,
  remaining,
  totalSeconds,
  isOwnerGuess,
  attemptIndex,
}: {
  titleCorrect: boolean;
  artistCorrect: boolean;
  remaining: number;
  totalSeconds: number;
  isOwnerGuess?: boolean;
  attemptIndex?: number;
}): number {
  if (isOwnerGuess) return titleCorrect ? 150 : 0;

  const bestBase = titleCorrect && artistCorrect ? 150 : titleCorrect ? 90 : artistCorrect ? 60 : 0;
  if (!bestBase) return 0;

  if (typeof attemptIndex === "number") {
    const factors = [1, 0.7, 0.45, 0.25];
    const factor = factors[Math.min(attemptIndex, factors.length - 1)] ?? 0.25;
    const score = Math.round(bestBase * factor);
    return Math.min(150, Math.max(0, score));
  }

  const timeRatio = totalSeconds > 0 ? Math.max(0, Math.min(1, remaining / totalSeconds)) : 0.5;
  const score = Math.round(bestBase * (0.3 + 0.7 * timeRatio));
  return Math.min(150, Math.max(0, score));
}

export function getPreviewSecondsForAttempt(attemptIndex: number): number {
  const durations = [1, 5, 10, 20];
  return durations[Math.min(attemptIndex, durations.length - 1)] ?? 20;
}

export function getPreviewStartSeconds(
  trackId: string,
  duration: number,
  previewSeconds: number,
  attemptIndex = 0,
): number {
  const maxStart = Math.max(0, duration - previewSeconds);
  if (!maxStart || !Number.isFinite(maxStart)) return 0;

  let hash = 2166136261;
  for (const character of `${trackId}:${attemptIndex}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967296) * maxStart;
}

export function getAttemptScoreFactor(attemptIndex: number): number {
  const factors = [1, 0.7, 0.45, 0.25];
  return factors[Math.min(attemptIndex, factors.length - 1)] ?? 0.25;
}

export function isOwnerModeSchemaMissingError(error: unknown): boolean {
  const message = (() => {
    if (error instanceof Error) return error.message;
    if (typeof error === "object" && error !== null && "message" in error) {
      const value = (error as { message?: unknown }).message;
      return typeof value === "string" ? value : "";
    }
    return String(error ?? "");
  })().toLowerCase();

  const missingColumns = ["playlist_name", "playlist_tracks", "source_player_name"];
  return message.includes("column") && missingColumns.some((column) => message.includes(column));
}

export function buildBlendTracks(
  players: Array<{
    name?: string;
    playlist_tracks?: Array<{
      title: string;
      artist: string;
      cover: string | null;
      releaseDate?: string;
    }>;
  }>,
) {
  const unique = new Map<
    string,
    {
      title: string;
      artist: string;
      cover: string | null;
      releaseDate?: string;
      sourcePlayerName?: string;
    }
  >();

  for (const player of players) {
    for (const track of player.playlist_tracks ?? []) {
      const key = `${track.title.trim().toLowerCase()}|${track.artist.trim().toLowerCase()}`;
      if (!unique.has(key)) {
        unique.set(key, {
          ...track,
          title: track.title.trim(),
          artist: track.artist.trim(),
          ...(player.name?.trim() ? { sourcePlayerName: player.name.trim() } : {}),
        });
      }
    }
  }

  return [...unique.values()];
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

export const db = supabase as unknown as {
  from: (table: string) => any;
  channel: typeof supabase.channel;
  removeChannel: typeof supabase.removeChannel;
};
