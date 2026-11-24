export type PlaylistProvider = "spotify" | "youtube" | "deezer";

export type PlaylistTrack = {
  title: string;
  artist: string;
  cover: string | null;
  releaseDate?: string;
  sourcePlayerName?: string;
  provider?: PlaylistProvider;
  /** Direct sources (YouTube and Deezer) already include their playback URL. */
  previewUrl?: string;
};

export type LoadedPlaylist = {
  name: string;
  image: string | null;
  tracks: PlaylistTrack[];
};

export function detectPlaylistProvider(input: string): PlaylistProvider {
  const value = input.trim().toLowerCase();
  if (value.includes("deezer.com/") || value.includes("deezer.page.link/")) return "deezer";
  if (value.includes("youtube.com/") || value.includes("youtu.be/") || /^(?:pl|uu|ll|rd|olak5uy_)[\w-]+$/i.test(value)) {
    return "youtube";
  }
  if (/^\d+$/.test(value)) return "deezer";
  return "spotify";
}

export function parseYoutubePlaylistId(input: string): string | null {
  const value = input.trim();
  if (/^(?:PL|UU|LL|RD|OLAK5uy_)[\w-]+$/i.test(value)) return value;
  const fromQuery = value.match(/[?&]list=([A-Za-z0-9_-]+)/)?.[1];
  return fromQuery ?? null;
}

export function parseDeezerPlaylistId(input: string): string | null {
  const value = input.trim();
  if (/^\d+$/.test(value)) return value;
  return value.match(/(?:^|\/)playlist\/(\d+)(?:[/?#]|$)/i)?.[1] ?? null;
}

export function getYouTubeVideoId(value: string | null | undefined): string | null {
  if (!value) return null;
  const input = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  const fromQuery = input.match(/[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)/)?.[1];
  if (fromQuery) return fromQuery;
  return input.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed|shorts|live)\/)([A-Za-z0-9_-]{11})(?:[?&#/]|$)/i)?.[1] ?? null;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export const PLAYLIST_PROVIDER_LABELS: Record<PlaylistProvider, string> = {
  spotify: "Spotify",
  youtube: "YouTube",
  deezer: "Deezer",
};
