import { supabase } from "@/integrations/supabase/client";

export type GameMode = "type" | "choice" | "owner";

export type RoomRow = {
  id: string;
  code: string;
  host_key: string;
  playlist_name: string;
  playlist_image: string | null;
  tracks: { title: string; artist: string; cover: string | null }[];
  rounds: number;
  seconds: number;
  mode: string;
  status: string;
  current_round: number;
  round_started_at: string | null;
};

export type PlayerRow = {
  id: string;
  room_id: string;
  name: string;
  client_key: string;
  score: number;
  is_host: boolean;
  playlist_name: string;
  playlist_tracks: { title: string; artist: string; cover: string | null }[];
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
