import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Music4, Radio, Type } from "lucide-react";

import { PlaylistPicker } from "@/components/playlist-picker";
import { loadPlaylist } from "@/lib/game.functions";
import { getSpotifyClientId } from "@/lib/spotify.functions";
import {
  clearSession,
  connectSpotify,
  fetchUserPlaylists,
  getSpotifyToken,
  isSpotifyConnected,
  playlistUrl,
  type UserPlaylist,
} from "@/lib/spotify";
import {
  db,
  getClientKey,
  getSavedName,
  isOwnerModeSchemaMissingError,
  makeCode,
  saveName,
  type GameMode,
} from "@/lib/room";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Blind Beat — Blind test multijugador con playlists de Spotify" },
      {
        name: "description",
        content:
          "Crea una sala, pega cualquier playlist de Spotify y compite adivinando canciones: escribe el título y el artista o elige entre cuatro opciones.",
      },
      { property: "og:title", content: "Blind Beat — Blind test multijugador" },
      {
        property: "og:description",
        content: "Salas en vivo, playlists de Spotify y canciones aleatorias en cada partida.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const runLoadPlaylist = useServerFn(loadPlaylist);
  const runClientId = useServerFn(getSpotifyClientId);

  const [name, setName] = useState("");
  const [playlist, setPlaylist] = useState("");
  const [mode, setMode] = useState<GameMode>("choice");
  const [teamBattle, setTeamBattle] = useState(false);
  const [rounds, setRounds] = useState(10);
  const [seconds, setSeconds] = useState(30);
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [spotify, setSpotify] = useState(false);
  const [linking, setLinking] = useState(false);
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setName(getSavedName());
    setSpotify(isSpotifyConnected());
    runClientId().then((r) => setClientId(r.clientId)).catch(() => setClientId(null));
  }, [runClientId]);

  useEffect(() => {
    if (!spotify || !clientId) {
      setPlaylists([]);
      setSelected(new Set());
      return;
    }
    let cancelled = false;
    setPlaylistsLoading(true);
    void (async () => {
      try {
        const token = await getSpotifyToken(clientId);
        if (!token) {
          if (!cancelled) setSpotify(false);
          return;
        }
        const list = await fetchUserPlaylists(token);
        if (!cancelled) setPlaylists(list);
      } catch (err) {
        if (!cancelled) {
          setPlaylists([]);
          setError(err instanceof Error ? err.message : "No pude cargar tus playlists.");
        }
      } finally {
        if (!cancelled) setPlaylistsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spotify, clientId]);

  function togglePlaylist(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSpotify() {
    setError(null);
    if (spotify) {
      clearSession();
      setSpotify(false);
      setPlaylists([]);
      setSelected(new Set());
      return;
    }
    if (!clientId) return setError("Spotify no está configurado en la app.");
    setLinking(true);
    try {
      await connectSpotify(clientId);
      setSpotify(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo conectar con Spotify.");
    } finally {
      setLinking(false);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Escribe tu nombre.");
    const urls = [
      ...[...selected].map(playlistUrl),
      ...(playlist.trim() ? [playlist.trim()] : []),
    ];
    if (!urls.length) {
      return setError(
        spotify
          ? "Elige una o más playlists, o pega un enlace."
          : "Pega el enlace de una playlist de Spotify.",
      );
    }
    setLoading(true);
    try {
      const accessToken = await getSpotifyToken(clientId);
      setSpotify(Boolean(accessToken));
      const data = await runLoadPlaylist({ data: { urls, accessToken } });
      if (data.tracks.length < 4) throw new Error("Esa playlist tiene muy pocas canciones.");


      const code = makeCode();
      const hostKey = getClientKey();
      saveName(name.trim());

      const { data: room, error: roomError } = await db
        .from("rooms")
        .insert({
          code,
          host_key: hostKey,
          playlist_name: mode === "owner" ? "Playlists de jugadores" : data.name,
          playlist_image: mode === "owner" ? null : data.image,
          tracks: mode === "owner" ? [] : data.tracks,
          rounds,
          seconds,
          mode,
          team_battle: teamBattle,
        })
        .select()
        .single();
      if (roomError) {
        if (mode === "owner" && isOwnerModeSchemaMissingError(roomError)) {
          throw new Error(
            "La base de datos aún no tiene la migración del modo '¿De quién es?'. Ejecuta la migración de Supabase para que funcione el modo propietario.",
          );
        }
        throw roomError;
      }

      const playerPayload = {
        room_id: room.id,
        name: name.trim(),
        client_key: hostKey,
        is_host: true,
        ...(teamBattle ? { team: "rojo" } : {}),
        ...(mode === "owner"
          ? { playlist_name: data.name, playlist_tracks: data.tracks }
          : {}),
      };
      const { error: playerError } = await db.from("players").insert(playerPayload);
      if (playerError) {
        if (mode === "owner" && isOwnerModeSchemaMissingError(playerError)) {
          throw new Error(
            "La base de datos aún no tiene las columnas del modo '¿De quién es?'. Ejecuta la migración de Supabase antes de crear la sala.",
          );
        }
        throw playerError;
      }

      navigate({ to: "/sala/$code", params: { code } });
    } catch (err) {
      setError(getErrorMessage(err, "Algo salió mal, inténtalo otra vez."));
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return setError("Escribe el código de la sala.");
    if (name.trim()) saveName(name.trim());
    navigate({ to: "/sala/$code", params: { code } });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-12 px-5 py-12">
      <header className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          <Radio className="size-3.5 text-primary" /> Blind test en vivo
        </span>
        <h1 className="mt-6 text-5xl font-bold sm:text-7xl">
          <span className="text-gradient">Blind Beat</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
          Pega cualquier playlist de Spotify, invita a tus amigos con un código y adivina canciones
          a contrarreloj. Cada partida sortea canciones distintas.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <form onSubmit={handleCreate} className="panel space-y-6 p-6 sm:p-8">
          <div>
            <h2 className="text-2xl font-bold">Crear sala</h2>
            <p className="text-sm text-muted-foreground">Tú serás el anfitrión de la partida.</p>
          </div>

          <Field label="Tu nombre">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="DJ Ana"
              maxLength={20}
              className="w-full rounded-xl border border-input bg-background/60 px-4 py-3 text-sm outline-none transition focus:border-primary"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/40 p-4">
            <button
              type="button"
              onClick={handleSpotify}
              disabled={linking}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-60 ${
                spotify
                  ? "border border-primary/50 text-primary hover:bg-primary/10"
                  : "bg-primary text-primary-foreground hover:brightness-110"
              }`}
            >
              {linking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : spotify ? (
                <Check className="size-4" />
              ) : (
                <Music4 className="size-4" />
              )}
              {spotify ? "Spotify conectado" : "Conectar mi Spotify"}
            </button>
            <p className="flex-1 text-xs text-muted-foreground">
              {spotify
                ? "Elige las playlists que quieras: se cargan todas las canciones. Pulsa para desconectar."
                : "Inicia sesión para ver tus playlists y cargarlas enteras, también las privadas."}
            </p>
          </div>

          {spotify && (
            <PlaylistPicker
              playlists={playlists}
              loading={playlistsLoading}
              selected={selected}
              onToggle={togglePlaylist}
            />
          )}

          <Field label={spotify ? "O pega un enlace" : "Playlist de Spotify"}>
            <input
              value={playlist}
              onChange={(e) => setPlaylist(e.target.value)}
              placeholder="https://open.spotify.com/playlist/..."
              className="w-full rounded-xl border border-input bg-background/60 px-4 py-3 text-sm outline-none transition focus:border-primary"
            />
          </Field>



          <Field label="Modo de juego">
            <div className="grid gap-3 sm:grid-cols-2">
              <ModeCard
                active={mode === "choice"}
                onClick={() => setMode("choice")}
                icon={<Music4 className="size-5" />}
                title="Opción múltiple"
                description="Suena la canción y eliges entre cuatro respuestas."
              />
              <ModeCard
                active={mode === "type"}
                onClick={() => setMode("type")}
                icon={<Type className="size-5" />}
                title="Escribir"
                description="Escribe el título y el artista antes de que acabe el tiempo."
              />
              <ModeCard
                active={mode === "tries"}
                onClick={() => setMode("tries")}
                icon={<Radio className="size-5" />}
                title="4 intentos"
                description="1s, 5s, 10s y 20s de pista; cada fallo descuenta puntos."
              />
              <ModeCard
                active={mode === "owner"}
                onClick={() => setMode("owner")}
                icon={<Radio className="size-5" />}
                title="¿De quién es?"
                description="Cada jugador aporta una playlist y adivinan quién la eligió."
              />
            </div>
          </Field>

          <label className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-4 py-3">
            <div>
              <div className="text-sm font-semibold">Batalla por equipos</div>
              <div className="text-xs text-muted-foreground">Crea dos equipos y suma puntos por equipo.</div>
            </div>
            <input
              type="checkbox"
              checked={teamBattle}
              onChange={(e) => setTeamBattle(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
          </label>

          <div className="grid gap-6 sm:grid-cols-2">
            <Slider
              label="Canciones por partida"
              value={rounds}
              min={3}
              max={30}
              onChange={setRounds}
              suffix="canciones"
            />
            <Slider
              label="Tiempo por canción"
              value={seconds}
              min={10}
              max={60}
              step={5}
              onChange={setSeconds}
              suffix="segundos"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="glow inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {loading
              ? selected.size > 1
                ? "Leyendo las playlists…"
                : "Leyendo la playlist…"
              : "Crear sala"}
          </button>
        </form>

        <div className="space-y-6">
          <form onSubmit={handleJoin} className="panel space-y-5 p-6 sm:p-8">
            <div>
              <h2 className="text-2xl font-bold">Unirse</h2>
              <p className="text-sm text-muted-foreground">¿Tienes un código? Entra aquí.</p>
            </div>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABC12"
              maxLength={6}
              className="w-full rounded-xl border border-input bg-background/60 px-4 py-4 text-center font-display text-3xl font-bold tracking-[0.4em] outline-none transition focus:border-primary"
            />
            <button
              type="submit"
              className="w-full rounded-xl border border-primary/50 px-6 py-3 text-sm font-bold text-primary transition hover:bg-primary/10"
            >
              Entrar a la sala
            </button>
          </form>

          <ul className="panel space-y-3 p-6 text-sm text-muted-foreground">
            <li>· Con Spotify puedes elegir varias playlists tuyas a la vez.</li>
            <li>· Se cargan todas las canciones, sin tope de 100.</li>
            <li>· Cada partida elige canciones al azar, nunca las mismas.</li>
            <li>· La música suena sola hasta que se acaba el tiempo.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition ${
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-background/40 text-muted-foreground hover:border-primary/40"
      }`}
    >
      <span className={active ? "text-primary" : ""}>{icon}</span>
      <span className="mt-2 block font-display text-base font-bold text-foreground">{title}</span>
      <span className="mt-1 block text-xs">{description}</span>
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span className="font-display text-lg font-bold text-primary">
          {value} <span className="text-xs text-muted-foreground">{suffix}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[oklch(0.86_0.21_150)]"
      />
    </div>
  );
}
