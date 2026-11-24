import {
  parseYoutubePlaylistId,
  youtubeWatchUrl,
  type LoadedPlaylist,
  type PlaylistTrack,
} from "./playlist-sources";

type JsonObject = Record<string, unknown>;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function text(value: unknown): string {
  const object = asObject(value);
  if (!object) return "";
  if (typeof object["content"] === "string") return object["content"];
  if (typeof object["simpleText"] === "string") return object["simpleText"];
  const runs = Array.isArray(object["runs"]) ? object["runs"] : [];
  return runs.map((run) => asObject(run)?.["text"] ?? "").join("");
}

function objectsForKey(root: unknown, key: string): JsonObject[] {
  const found: JsonObject[] = [];
  const visited = new Set<unknown>();
  const visit = (value: unknown) => {
    if (visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const object = asObject(value);
    if (!object) return;
    const direct = asObject(object[key]);
    if (direct) found.push(direct);
    Object.values(object).forEach(visit);
  };
  visit(root);
  return found;
}

function firstObject(root: unknown, key: string): JsonObject | null {
  return objectsForKey(root, key)[0] ?? null;
}

/** Extracts a balanced JSON object assigned in a script, without brittle greedy regexes. */
export function extractAssignedJson(html: string, marker: string): unknown | null {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function cleanVideoTitle(value: string): string {
  return value
    .replace(/\s*[\[(](?:official\s+)?(?:music\s+)?(?:video|audio|lyric\s+video|lyrics|visuali[sz]er|hd|4k|m\/v)[^\])]*[\])]\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Standard uploads often use “Artist — Song”; YouTube Music already supplies both fields. */
export function splitYoutubeTitle(rawTitle: string, channel: string): { title: string; artist: string } {
  const cleaned = cleanVideoTitle(rawTitle);
  const parts = cleaned.split(/\s+[-–—]\s+/);
  if (parts.length >= 2 && channel) {
    const left = parts.shift()!.trim();
    const normalizedLeft = left.toLocaleLowerCase();
    const normalizedChannel = channel.toLocaleLowerCase();
    if (normalizedLeft.includes(normalizedChannel) || normalizedChannel.includes(normalizedLeft)) {
      return { title: parts.join(" - ").trim(), artist: left };
    }
  }
  return { title: cleaned, artist: channel || "Artista desconocido" };
}

function thumbnails(value: unknown): string | null {
  const object = asObject(value);
  const sources = Array.isArray(object?.["sources"])
    ? object["sources"]
    : Array.isArray(object?.["thumbnails"])
      ? object["thumbnails"]
      : [];
  const urls = sources
    .map((source) => asObject(source)?.["url"])
    .filter((url): url is string => typeof url === "string");
  return urls.at(-1) ?? null;
}

function fromClassicRenderer(renderer: JsonObject): PlaylistTrack | null {
  const videoId = typeof renderer["videoId"] === "string" ? renderer["videoId"] : "";
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || renderer["isPlayable"] === false) return null;
  const rawTitle = text(renderer["title"]);
  const channel = text(renderer["shortBylineText"]) || text(renderer["longBylineText"]);
  if (!rawTitle) return null;
  const parsed = splitYoutubeTitle(rawTitle, channel);
  return {
    ...parsed,
    cover: thumbnails(renderer["thumbnail"]) ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    provider: "youtube",
    previewUrl: youtubeWatchUrl(videoId),
  };
}

function fromLockup(renderer: JsonObject): PlaylistTrack | null {
  const videoId = typeof renderer["contentId"] === "string" ? renderer["contentId"] : "";
  const contentType = typeof renderer["contentType"] === "string" ? renderer["contentType"] : "";
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || (contentType && !contentType.includes("VIDEO"))) return null;
  const metadata = asObject(asObject(renderer["metadata"])?.["lockupMetadataViewModel"]);
  const rawTitle = text(metadata?.["title"]);
  const metadataView = asObject(asObject(metadata?.["metadata"])?.["contentMetadataViewModel"]);
  const rows = Array.isArray(metadataView?.["metadataRows"]) ? metadataView["metadataRows"] : [];
  const firstRow = asObject(rows[0]);
  const parts = Array.isArray(firstRow?.["metadataParts"]) ? firstRow["metadataParts"] : [];
  const channel = text(asObject(parts[0])?.["text"]);
  if (!rawTitle) return null;
  const parsed = splitYoutubeTitle(rawTitle, channel);
  const image = asObject(asObject(renderer["contentImage"])?.["thumbnailViewModel"]);
  return {
    ...parsed,
    cover: thumbnails(image?.["image"]) ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    provider: "youtube",
    previewUrl: youtubeWatchUrl(videoId),
  };
}

function continuationToken(root: unknown): string | null {
  for (const item of objectsForKey(root, "continuationItemViewModel")) {
    const command = asObject(asObject(item["continuationCommand"])?.["innertubeCommand"]);
    const continuation = asObject(command?.["continuationCommand"]);
    if (typeof continuation?.["token"] === "string") return continuation["token"];
  }
  for (const item of objectsForKey(root, "continuationItemRenderer")) {
    const endpoint = asObject(item["continuationEndpoint"]);
    const continuation = asObject(endpoint?.["continuationCommand"]);
    if (typeof continuation?.["token"] === "string") return continuation["token"];
    const next = asObject(item["nextContinuationData"]);
    if (typeof next?.["continuation"] === "string") return next["continuation"];
  }
  return null;
}

export function parseYoutubeItems(root: unknown): { tracks: PlaylistTrack[]; continuation: string | null } {
  const tracks: PlaylistTrack[] = [];
  for (const renderer of objectsForKey(root, "playlistVideoRenderer")) {
    const track = fromClassicRenderer(renderer);
    if (track) tracks.push(track);
  }
  for (const renderer of objectsForKey(root, "lockupViewModel")) {
    const track = fromLockup(renderer);
    if (track) tracks.push(track);
  }
  return { tracks, continuation: continuationToken(root) };
}

export function parseYoutubePlaylistPage(html: string) {
  const initialData =
    extractAssignedJson(html, "var ytInitialData =") ?? extractAssignedJson(html, "ytInitialData =");
  if (!initialData) throw new Error("YouTube no devolvió una playlist pública válida.");
  const metadata = firstObject(initialData, "playlistMetadataRenderer");
  const page = parseYoutubeItems(initialData);
  const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? "";
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? "";
  return {
    name: typeof metadata?.["title"] === "string" ? metadata["title"] : "Playlist de YouTube",
    tracks: page.tracks,
    continuation: page.continuation,
    key,
    clientVersion,
  };
}

export async function fetchYoutubePlaylist(input: string): Promise<LoadedPlaylist> {
  const playlistId = parseYoutubePlaylistId(input);
  if (!playlistId) throw new Error("Ese enlace no parece una playlist de YouTube.");
  const response = await fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=es`, {
    headers: { "user-agent": USER_AGENT, "accept-language": "es" },
  });
  if (!response.ok) throw new Error("YouTube no permitió leer esa playlist pública.");
  const page = parseYoutubePlaylistPage(await response.text());
  const unique = new Map<string, PlaylistTrack>();
  const addTracks = (tracks: PlaylistTrack[]) => {
    for (const track of tracks) {
      const id = track.previewUrl ?? `${track.title}|${track.artist}`;
      if (!unique.has(id)) unique.set(id, track);
    }
  };
  addTracks(page.tracks);
  let continuation = page.continuation;

  for (let pageIndex = 0; continuation && pageIndex < 50; pageIndex += 1) {
    if (!page.key || !page.clientVersion) break;
    const nextResponse = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(page.key)}&prettyPrint=false`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT },
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: page.clientVersion, hl: "es", gl: "US" } },
        continuation,
      }),
    });
    if (!nextResponse.ok) break;
    const next = parseYoutubeItems(await nextResponse.json());
    const before = unique.size;
    addTracks(next.tracks);
    if (unique.size === before && !next.tracks.length) break;
    if (next.continuation === continuation) break;
    continuation = next.continuation;
  }

  const tracks = [...unique.values()];
  if (!tracks.length) throw new Error("No encontré canciones públicas en esa playlist de YouTube.");
  return { name: page.name, image: tracks[0]?.cover ?? null, tracks };
}
