/** Browser-side Spotify login (Authorization Code + PKCE, no secret needed). */

const STORE = "blindbeat.spotify";
const VERIFIER = "blindbeat.spotify.verifier";
const CLIENT = "blindbeat.spotify.client";

export const SPOTIFY_SCOPES = "playlist-read-private playlist-read-collaborative";

export type SpotifySession = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
};

export function redirectUri(): string {
  return `${window.location.origin}/spotify/callback`;
}

export function readSession(): SpotifySession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as SpotifySession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: SpotifySession) {
  window.localStorage.setItem(STORE, JSON.stringify(session));
}

export function clearSession() {
  window.localStorage.removeItem(STORE);
}

export function isSpotifyConnected(): boolean {
  const s = readSession();
  return Boolean(s?.refreshToken || (s && s.expiresAt > Date.now()));
}

export type UserPlaylist = {
  id: string;
  name: string;
  image: string | null;
  tracks: number;
  owner: string;
};

/** Every playlist the logged-in account can read (created + followed). */
export async function fetchUserPlaylists(accessToken: string): Promise<UserPlaylist[]> {
  const playlists: UserPlaylist[] = [];
  let url: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";
  while (url && playlists.length < 500) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      if (res.status === 401) {
        clearSession();
        throw new Error("La sesión de Spotify caducó. Vuelve a conectar.");
      }
      throw new Error("No pude leer tus playlists de Spotify.");
    }
    const page = (await res.json()) as {
      next: string | null;
      items: {
        id?: string;
        name?: string;
        images?: { url: string }[];
        tracks?: { total?: number };
        owner?: { display_name?: string };
      }[];
    };
    for (const item of page.items ?? []) {
      if (!item?.id || !item.name) continue;
      playlists.push({
        id: item.id,
        name: item.name,
        image: item.images?.[0]?.url ?? null,
        tracks: item.tracks?.total ?? 0,
        owner: item.owner?.display_name ?? "",
      });
    }
    url = page.next;
  }
  return playlists;
}

export function playlistUrl(id: string) {
  return `https://open.spotify.com/playlist/${id}`;
}

function randomString(length: number) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function base64url(buffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function buildAuthUrl(clientId: string) {
  const verifier = randomString(64);
  const challenge = base64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  window.localStorage.setItem(VERIFIER, verifier);
  window.localStorage.setItem(CLIENT, clientId);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

/** Runs inside the popup landing page. */
export async function exchangeCode(code: string): Promise<SpotifySession> {
  const verifier = window.localStorage.getItem(VERIFIER);
  const clientId = window.localStorage.getItem(CLIENT);
  if (!verifier || !clientId) throw new Error("Falta la sesión de conexión.");
  try {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
        code_verifier: verifier,
      }),
    });
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new Error(json.error_description ?? "Spotify rechazó la conexión.");
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
    };
  } finally {
    window.localStorage.removeItem(VERIFIER);
    window.localStorage.removeItem(CLIENT);
  }
}

async function refresh(clientId: string, refreshToken: string): Promise<SpotifySession | null> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) return null;
  const session: SpotifySession = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
  };
  saveSession(session);
  return session;
}

/** Valid access token for the logged-in Spotify account, or null. */
export async function getSpotifyToken(clientId: string | null): Promise<string | null> {
  const session = readSession();
  if (!session) return null;
  if (session.expiresAt > Date.now()) return session.accessToken;
  if (!session.refreshToken || !clientId) {
    clearSession();
    return null;
  }
  const fresh = await refresh(clientId, session.refreshToken);
  if (!fresh) {
    clearSession();
    return null;
  }
  return fresh.accessToken;
}

/** Opens the Spotify consent popup and resolves once the session is stored. */
export async function connectSpotify(clientId: string): Promise<void> {
  const popup = window.open("", "spotify-login", "width=520,height=720");
  if (!popup) throw new Error("Permite las ventanas emergentes para conectar Spotify.");
  let url: string;
  try {
    url = await buildAuthUrl(clientId);
  } catch (err) {
    popup.close();
    throw err;
  }

  const done = new Promise<void>((resolve, reject) => {
    let poll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (poll !== undefined) window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; session?: SpotifySession; error?: string };
      if (data?.type !== "spotifyAuth") return;
      cleanup();
      if (data.session) {
        saveSession(data.session);
        resolve();
      } else {
        reject(new Error(data.error ?? "No se pudo conectar con Spotify."));
      }
    };
    window.addEventListener("message", onMessage);
    poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      if (isSpotifyConnected()) resolve();
      else reject(new Error("Cerraste la ventana antes de terminar."));
    }, 500);
  });

  popup.location.href = url;
  await done;
}
