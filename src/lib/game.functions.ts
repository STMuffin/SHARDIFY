import { createServerFn } from "@tanstack/react-start";

export type LoadedPlaylist = {
  name: string;
  image: string | null;
  tracks: { title: string; artist: string; cover: string | null }[];
};

/** Reads every song of a public Spotify playlist (no login needed). */
export const loadPlaylist = createServerFn({ method: "POST" })
  .inputValidator((data: { url: string }) => {
    if (!data?.url || typeof data.url !== "string") throw new Error("Falta el enlace de la playlist.");
    return { url: data.url };
  })
  .handler(async ({ data }): Promise<LoadedPlaylist> => {
    const { fetchPlaylist } = await import("./music.server");
    const result = await fetchPlaylist(data.url);
    return result;
  });

/** Finds playable 30s clips for a shuffled set of candidate songs. */
export const findPlayableTracks = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      candidates: { title: string; artist: string; cover: string | null }[];
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
