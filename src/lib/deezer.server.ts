import { parseDeezerPlaylistId, type LoadedPlaylist, type PlaylistTrack } from "./playlist-sources";

type DeezerTrack = {
  id?: number;
  title?: string;
  preview?: string;
  artist?: { name?: string };
  album?: { cover_xl?: string; cover_big?: string; release_date?: string };
};

type DeezerTrackPage = { data?: DeezerTrack[]; next?: string | null; total?: number };
type DeezerPlaylist = {
  title?: string;
  picture_xl?: string;
  picture_big?: string;
  tracks?: DeezerTrackPage;
  error?: { message?: string };
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Deezer no permitió leer esa playlist pública.");
  return (await response.json()) as T;
}

function mapTrack(track: DeezerTrack): PlaylistTrack | null {
  if (!track.title || !track.artist?.name) return null;
  return {
    title: track.title,
    artist: track.artist.name,
    cover: track.album?.cover_xl ?? track.album?.cover_big ?? null,
    ...(track.album?.release_date ? { releaseDate: track.album.release_date } : {}),
    provider: "deezer",
    ...(track.preview ? { previewUrl: track.preview } : {}),
  };
}

export async function fetchDeezerPlaylist(input: string): Promise<LoadedPlaylist> {
  const playlistId = parseDeezerPlaylistId(input);
  if (!playlistId) throw new Error("Ese enlace no parece una playlist de Deezer.");
  const playlist = await getJson<DeezerPlaylist>(`https://api.deezer.com/playlist/${playlistId}`);
  if (playlist.error || !playlist.tracks) {
    throw new Error(playlist.error?.message || "No encontré esa playlist pública de Deezer.");
  }

  const tracks: PlaylistTrack[] = [];
  const seen = new Set<number>();
  const addPage = (page: DeezerTrackPage) => {
    for (const item of page.data ?? []) {
      const track = mapTrack(item);
      if (!track) continue;
      if (typeof item.id === "number") {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
      }
      tracks.push(track);
    }
  };
  addPage(playlist.tracks);

  let next = playlist.tracks.next ?? null;
  for (let pageIndex = 0; next && pageIndex < 100; pageIndex += 1) {
    const page = await getJson<DeezerTrackPage>(next);
    addPage(page);
    next = page.next ?? null;
  }
  if (!tracks.length) throw new Error("No encontré canciones en esa playlist de Deezer.");
  return {
    name: playlist.title ?? "Playlist de Deezer",
    image: playlist.picture_xl ?? playlist.picture_big ?? tracks[0]?.cover ?? null,
    tracks,
  };
}
