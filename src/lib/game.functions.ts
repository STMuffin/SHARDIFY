import { createServerFn } from "@tanstack/react-start";

export type LoadedPlaylist = {
  name: string;
  image: string | null;
  tracks: { title: string; artist: string; cover: string | null; releaseDate?: string }[];
};

/** Reads every song of one or more Spotify playlists. */
export const loadPlaylist = createServerFn({ method: "POST" })
  .inputValidator((data: { url?: string; urls?: string[]; accessToken?: string | null }) => {
    const urls = [
      ...(Array.isArray(data?.urls)
        ? data.urls.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
        : []),
      ...(typeof data?.url === "string" && data.url.trim() ? [data.url.trim()] : []),
    ];
    if (!urls.length) throw new Error("Falta el enlace de la playlist.");
    return {
      urls,
      accessToken: typeof data.accessToken === "string" ? data.accessToken : null,
    };
  })
  .handler(async ({ data }): Promise<LoadedPlaylist> => {
    const { fetchPlaylists } = await import("./music.server");
    return fetchPlaylists(data.urls, data.accessToken);
  });

/** Finds playable 30s clips for a shuffled set of candidate songs. */
export const findPlayableTracks = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      candidates: {
        title: string;
        artist: string;
        cover: string | null;
        releaseDate?: string;
        sourcePlayerName?: string;
      }[];
      need: number;
    }) => {
      if (!Array.isArray(data?.candidates)) throw new Error("Faltan canciones.");
      return {
        candidates: data.candidates.slice(0, 200),
        need: Math.max(1, Math.min(50, Number(data.need) || 10)),
      };
    },
  )
  .handler(async ({ data }) => {
    const { resolvePlayable } = await import("./music.server");
    const playable = await resolvePlayable(data.candidates, data.need);
    return { tracks: playable };
  });
