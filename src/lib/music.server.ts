import { similarity } from "./match";

export type PlaylistTrack = {
  title: string;
  artist: string;
  cover: string | null;
};

export type PlayableTrack = PlaylistTrack & { previewUrl: string };

export function parsePlaylistId(input: string): string | null {
  const value = input.trim();
  const uri = value.match(/spotify:playlist:([A-Za-z0-9]+)/);
  if (uri?.[1]) return uri[1];
  const url = value.match(/playlist\/([A-Za-z0-9]+)/);
  if (url?.[1]) return url[1];
  if (/^[A-Za-z0-9]{16,}$/.test(value)) return value;
  return null;
}

async function getAppToken(): Promise<string | null> {
  const id = process.env["SPOTIFY_CLIENT_ID"];
  const secret = process.env["SPOTIFY_CLIENT_SECRET"];
  if (!id || !secret) return null;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${btoa(`${id}:${secret}`)}`,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string };
  return json.access_token ?? null;
}

/** Full playlist via the official API (all pages, no size limit). */
async function fetchViaApi(playlistId: string, token: string, fromUser = false) {
  const head = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,images`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!head.ok) {
    console.error("[spotify] playlist head failed", head.status, await head.text());
    return null;
  }
  const meta = (await head.json()) as { name?: string; images?: { url: string }[] };

  const tracks: PlaylistTrack[] = [];
  const market = fromUser ? "from_token" : "US";
  let url:
    | string
    | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&offset=0&market=${market}`;

  while (url && tracks.length < 5000) {
    const res: Response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.error("[spotify] tracks page failed", res.status, await res.text());
      break;
    }
    const page = (await res.json()) as {
      next: string | null;
      items: {
        track: {
          name?: string;
          artists?: { name: string }[];
          album?: { images?: { url: string }[] };
        } | null;
      }[];
    };
    for (const item of page.items ?? []) {
      const t = item.track;
      if (!t?.name || !t.artists?.length) continue;
      tracks.push({
        title: t.name,
        artist: t.artists.map((a) => a.name).join(", "),
        cover: t.album?.images?.[0]?.url ?? null,
      });
    }
    url = page.next;
  }

  return {
    name: meta.name ?? "Playlist",
    image: meta.images?.[0]?.url ?? null,
    tracks,
  };
}

/** Fallback that needs no credentials: the public embed payload. */
async function fetchViaEmbed(playlistId: string) {
  const res = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "accept-language": "en",
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match?.[1]) return null;
  try {
    const data = JSON.parse(match[1]) as any;
    const entity = data?.props?.pageProps?.state?.data?.entity;
    // Make sure Spotify returned the playlist we asked for, not a fallback one.
    const uri: string = entity?.uri ?? "";
    if (uri && !uri.endsWith(playlistId)) return null;
    const list = entity?.trackList ?? [];
    const tracks: PlaylistTrack[] = [];
    for (const t of list) {
      if (!t?.title || !t?.subtitle) continue;
      tracks.push({ title: t.title, artist: t.subtitle, cover: entity?.coverArt?.sources?.[0]?.url ?? null });
    }
    if (!tracks.length) return null;

    return {
      name: entity?.name ?? "Playlist",
      image: entity?.coverArt?.sources?.[0]?.url ?? null,
      tracks,
    };
  } catch {
    return null;
  }
}

export async function fetchPlaylist(input: string, userToken?: string | null) {
  const id = parsePlaylistId(input);
  if (!id) throw new Error("Ese enlace no parece una playlist de Spotify.");
  // A logged-in user token reads the whole playlist (including private ones).
  let result = userToken ? await fetchViaApi(id, userToken, true) : null;
  if (!result?.tracks.length) {
    const token = await getAppToken();
    result = token ? await fetchViaApi(id, token, false) : null;
  }
  // The API can answer with an empty list (region/market quirks); fall back then too.
  if (!result?.tracks.length) result = await fetchViaEmbed(id);
  if (!result || !result.tracks.length) {
    throw new Error(
      "No pude leer esa playlist. Comprueba que sea pública o inicia sesión con Spotify.",
    );
  }
  return result;
}

export async function fetchPlaylists(inputs: string[], userToken?: string | null) {
  const unique = [...new Set(inputs.map((s) => s.trim()).filter(Boolean))];
  if (!unique.length) throw new Error("Elige al menos una playlist.");

  const settled = await Promise.allSettled(unique.map((url) => fetchPlaylist(url, userToken)));
  const parts = settled
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchPlaylist>>> => r.status === "fulfilled")
    .map((r) => r.value);

  if (!parts.length) {
    const first = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw first?.reason instanceof Error
      ? first.reason
      : new Error("No pude leer esas playlists.");
  }

  const seen = new Set<string>();
  const tracks: PlaylistTrack[] = [];
  for (const part of parts) {
    for (const track of part.tracks) {
      const key = `${track.title.toLowerCase()}|${track.artist.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push(track);
    }
  }

  const names = parts.map((p) => p.name);
  const extra = names.length > 3 ? ` +${names.length - 3}` : "";
  return {
    name: names.length === 1 ? names[0]! : `${names.slice(0, 3).join(" + ")}${extra}`,
    image: parts[0]?.image ?? null,
    tracks,
  };
}


async function previewFromItunes(track: PlaylistTrack) {
  const term = encodeURIComponent(`${track.artist} ${track.title}`);
  const res = await fetch(
    `https://itunes.apple.com/search?term=${term}&entity=song&limit=5`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    results?: { trackName?: string; artistName?: string; previewUrl?: string; artworkUrl100?: string }[];
  };
  let best: { url: string; cover: string | null; score: number } | null = null;
  for (const r of json.results ?? []) {
    if (!r.previewUrl || !r.trackName) continue;
    const score =
      similarity(r.trackName, track.title) * 0.7 +
      similarity(r.artistName ?? "", track.artist) * 0.3;
    if (!best || score > best.score) {
      best = {
        url: r.previewUrl,
        cover: r.artworkUrl100?.replace("100x100", "400x400") ?? null,
        score,
      };
    }
  }
  return best && best.score >= 0.55 ? best : null;
}

async function previewFromDeezer(track: PlaylistTrack) {
  const term = encodeURIComponent(`${track.artist} ${track.title}`);
  const res = await fetch(`https://api.deezer.com/search?q=${term}&limit=5`);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: { title?: string; preview?: string; artist?: { name?: string }; album?: { cover_big?: string } }[];
  };
  let best: { url: string; cover: string | null; score: number } | null = null;
  for (const r of json.data ?? []) {
    if (!r.preview || !r.title) continue;
    const score =
      similarity(r.title, track.title) * 0.7 +
      similarity(r.artist?.name ?? "", track.artist) * 0.3;
    if (!best || score > best.score) {
      best = { url: r.preview, cover: r.album?.cover_big ?? null, score };
    }
  }
  return best && best.score >= 0.55 ? best : null;
}

export async function resolvePreview(track: PlaylistTrack): Promise<PlayableTrack | null> {
  try {
    // Deezer serves MP3 (playable everywhere); iTunes AAC is the fallback.
    const found = (await previewFromDeezer(track)) ?? (await previewFromItunes(track));
    if (!found) return null;
    return { ...track, previewUrl: found.url, cover: track.cover ?? found.cover };
  } catch {
    return null;
  }
}

/** Resolve playable previews for as many candidates as needed, in batches. */
export async function resolvePlayable(
  candidates: PlaylistTrack[],
  need: number,
): Promise<PlayableTrack[]> {
  const playable: PlayableTrack[] = [];
  const batchSize = 8;
  for (let i = 0; i < candidates.length && playable.length < need; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((t) => resolvePreview(t)));
    for (const r of results) {
      if (r && playable.length < need) playable.push(r);
    }
  }
  return playable;
}
