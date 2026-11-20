import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronDown,
  Link2,
  ListMusic,
  Loader2,
  Mic2,
  Music2,
  Play,
  Radio,
  Timer,
  Type,
  UserRoundSearch,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

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
      { title: "SHARDIFY — Blind test multijugador con playlists de Spotify" },
      {
        name: "description",
        content:
          "Crea una sala, pega cualquier playlist de Spotify y compite adivinando canciones: escribe el título y el artista o elige entre cuatro opciones.",
      },
      { property: "og:title", content: "SHARDIFY — Blind test multijugador" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        property: "og:description",
        content: "Salas en vivo, playlists de Spotify y canciones aleatorias en cada partida.",
      },
    ],
  }),
  component: Home,
});

const MODES: { value: GameMode; title: string; description: string; icon: LucideIcon }[] = [
  {
    value: "choice",
    title: "Opción múltiple",
    description: "Elige la canción correcta entre cuatro opciones.",
    icon: ListMusic,
  },
  {
    value: "type",
    title: "Escribir",
    description: "Adivina el título y el artista escribiendo en el chat.",
    icon: Type,
  },
  {
    value: "tries",
    title: "4 intentos",
    description: "Cada fallo alarga el fragmento y reduce los puntos.",
    icon: Timer,
  },
  {
    value: "chronology",
    title: "Cronología",
    description: "Decide qué canción salió antes y cuál después.",
    icon: ArrowUpDown,
  },
  {
    value: "owner",
    title: "¿De quién es?",
    description: "Adivina quién aportó cada canción de la partida.",
    icon: UserRoundSearch,
  },
  {
    value: "artist",
    title: "Adivina el artista",
    description: "Reconoce quién canta entre cuatro artistas.",
    icon: Mic2,
  },
];

function Home() {
  const navigate = useNavigate();
  const runLoadPlaylist = useServerFn(loadPlaylist);
  const runClientId = useServerFn(getSpotifyClientId);

  const [name, setName] = useState("");
  const [playlist, setPlaylist] = useState("");
  const [mode, setMode] = useState<GameMode>("choice");
  const [blend, setBlend] = useState(false);
  const [teamBattle, setTeamBattle] = useState(false);
  const [rounds, setRounds] = useState(10);
  const [seconds, setSeconds] = useState(30);
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [spotify, setSpotify] = useState(false);
  const [linking, setLinking] = useState(false);
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setName(getSavedName());
    setSpotify(isSpotifyConnected());
    runClientId()
      .then((r) => setClientId(r.clientId))
      .catch(() => setClientId(null));
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
          if (!cancelled) {
            setSpotify(false);
            setPlaylists([]);
            setError("La sesión de Spotify caducó. Vuelve a conectar para ver tus playlists.");
          }
          return;
        }
        const list = await fetchUserPlaylists(token);
        if (!cancelled) {
          setPlaylists(list);
          setError(null);
        }
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
    const usePlayerPlaylists = mode === "owner" || blend;
    if (!usePlayerPlaylists && !urls.length) {
      return setError(
        spotify
          ? "Elige una o más playlists, o pega un enlace."
          : "Pega el enlace de una playlist de Spotify.",
      );
    }
    setLoading(true);
    try {
      let data: {
        name: string;
        image: string | null;
        tracks: { title: string; artist: string; cover: string | null; releaseDate?: string }[];
      } = { name: "Blend de jugadores", image: null, tracks: [] };

      if (urls.length) {
        const accessToken = await getSpotifyToken(clientId);
        setSpotify(Boolean(accessToken));
        data = await runLoadPlaylist({ data: { urls, accessToken } });
        if (data.tracks.length < 4) throw new Error("Esa playlist tiene muy pocas canciones.");
      }

      const code = makeCode();
      const hostKey = getClientKey();
      saveName(name.trim());

      const { data: room, error: roomError } = await db
        .from("rooms")
        .insert({
          code,
          host_key: hostKey,
          playlist_name:
            mode === "owner"
              ? "Playlists de jugadores"
              : usePlayerPlaylists
                ? "Blend de jugadores"
                : data.name,
          playlist_image: usePlayerPlaylists ? null : data.image,
          tracks: usePlayerPlaylists ? [] : data.tracks,
          rounds,
          seconds,
          mode,
          blend: blend && mode !== "owner",
          team_battle: teamBattle,
        })
        .select()
        .single();
      if (roomError) {
        if (mode === "owner" && isOwnerModeSchemaMissingError(roomError)) {
          throw new Error("El modo ‘¿De quién es?’ todavía no está disponible. Prueba otro modo.");
        }
        throw roomError;
      }

      const playerPayload = {
        room_id: room.id,
        name: name.trim(),
        client_key: hostKey,
        is_host: true,
        ...(teamBattle ? { team: "rojo" } : {}),
        ...(usePlayerPlaylists
          ? { playlist_name: data.name, playlist_tracks: data.tracks }
          : {}),
      };
      const { error: playerError } = await db.from("players").insert(playerPayload);
      if (playerError) {
        if (mode === "owner" && isOwnerModeSchemaMissingError(playerError)) {
          throw new Error("El modo ‘¿De quién es?’ todavía no está disponible. Prueba otro modo.");
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
    setJoinError(null);
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return setJoinError("Escribe el código de la sala.");
    if (name.trim()) saveName(name.trim());
    navigate({ to: "/sala/$code", params: { code } });
  }

  const selectedMode = MODES.find((item) => item.value === mode) ?? MODES[0];

  return (
    <main className="mx-auto w-full max-w-7xl px-5 pb-12 sm:px-8">
      <section className="grid border-b border-border lg:grid-cols-[0.92fr_1.08fr]">
        <div className="flex flex-col justify-between py-12 pr-0 sm:py-16 lg:py-20 lg:pr-14">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
              Blind test multijugador
            </p>
            <h1 className="mt-7 font-display text-[clamp(3.6rem,8vw,7.4rem)] leading-[0.88] uppercase">
              Suena.
              <span className="block text-primary">Adivina.</span>
              Gana.
            </h1>
            <p className="mt-7 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
              Tu playlist de Spotify se convierte en una partida en vivo. Sin registros, sin
              instalaciones y con canciones distintas cada vez.
            </p>
          </div>

          <div className="mt-10 flex max-w-md items-center gap-4 border-t border-border pt-6">
            <div className="relative flex size-20 shrink-0 items-center justify-center rounded-full border-[10px] border-foreground bg-primary text-primary-foreground">
              <AudioLines className="size-7" aria-hidden="true" />
              <span className="absolute size-2 rounded-full bg-background" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Ahora suena
              </p>
              <p className="mt-1 truncate font-display text-lg">Tu próxima partida</p>
              <div className="mt-3 flex h-4 items-end gap-1" aria-hidden="true">
                {[9, 15, 7, 12, 16, 8, 13, 6, 11, 15, 9, 4].map((height, index) => (
                  <span
                    key={index}
                    className="w-1 rounded-full bg-primary"
                    style={{ height }}
                  />
                ))}
              </div>
            </div>
            <span className="font-display text-sm tabular-nums">00:30</span>
          </div>
        </div>

        <form
          onSubmit={handleCreate}
          className="panel my-6 space-y-6 p-5 sm:my-10 sm:p-8 lg:ml-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                Nueva partida
              </p>
              <h2 className="mt-1 font-display text-2xl">Crea tu sala</h2>
            </div>
            <span className="flex size-10 items-center justify-center rounded-full bg-secondary text-foreground">
              <Play className="size-4 fill-current" aria-hidden="true" />
            </span>
          </div>

          <Field label="Tu nombre" htmlFor="player-name">
            <input
              id="player-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="DJ Ana"
              autoComplete="nickname"
              maxLength={20}
              className="field-input"
            />
          </Field>

          <div className="border-y border-border py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold">Tu música</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {spotify ? "Spotify conectado" : "Pega un enlace o conecta tu cuenta"}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSpotify}
                disabled={linking}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold disabled:opacity-60 ${
                  spotify
                    ? "border border-border bg-background text-foreground hover:bg-secondary"
                    : "bg-foreground text-background hover:bg-foreground/90"
                }`}
              >
                {linking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : spotify ? (
                  <Check className="size-4 text-primary" />
                ) : (
                  <Music2 className="size-4" />
                )}
                {spotify ? "Desconectar" : "Conectar Spotify"}
              </button>
            </div>

            {spotify && (
              <div className="pop-in mt-5">
                <PlaylistPicker
                  playlists={playlists}
                  loading={playlistsLoading}
                  selected={selected}
                  onToggle={togglePlaylist}
                />
              </div>
            )}

            <div className="relative mt-4">
              <Link2
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                value={playlist}
                onChange={(e) => setPlaylist(e.target.value)}
                placeholder="https://open.spotify.com/playlist/..."
                aria-label={spotify ? "Otro enlace de playlist" : "Playlist de Spotify"}
                className="field-input pl-10"
              />
            </div>
          </div>

          <fieldset>
            <legend className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Modo de juego
            </legend>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MODES.map((item) => {
                const Icon = item.icon;
                const active = mode === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setMode(item.value)}
                    className={`min-h-20 rounded-xl border p-3 text-left ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-foreground hover:border-foreground/40"
                    }`}
                  >
                    <Icon className={`size-4 ${active ? "" : "text-primary"}`} aria-hidden="true" />
                    <span className="mt-2 block text-xs font-bold leading-tight">{item.title}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{selectedMode?.description}</p>
          </fieldset>

          <details className="group border-t border-border pt-4">
            <summary className="flex list-none items-center justify-between gap-3 text-sm font-bold">
              <span>Opciones de partida</span>
              <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                {rounds} canciones · {seconds} s
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="mt-5 space-y-5">
              {mode !== "owner" && (
                <Toggle
                  checked={blend}
                  onChange={setBlend}
                  title="Blend"
                  description="Mezcla las playlists de todos los jugadores."
                />
              )}
              <Toggle
                checked={teamBattle}
                onChange={setTeamBattle}
                title="Batalla por equipos"
                description="Forma dos equipos y sumad vuestros puntos."
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <Slider
                  label="Canciones"
                  value={rounds}
                  min={3}
                  max={30}
                  onChange={setRounds}
                  suffix="rondas"
                />
                <Slider
                  label="Tiempo"
                  value={seconds}
                  min={10}
                  max={30}
                  step={5}
                  onChange={setSeconds}
                  suffix="segundos"
                />
              </div>
            </div>
          </details>

          {error && (
            <p role="alert" className="pop-in rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="glow inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {loading
              ? selected.size > 1
                ? "Leyendo las playlists…"
                : "Leyendo la playlist…"
              : "Crear sala"}
          </button>
        </form>
      </section>

      <section className="grid border-b border-border md:grid-cols-[0.92fr_1.08fr]">
        <form onSubmit={handleJoin} className="py-10 md:pr-14">
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            <UsersRound className="size-4" /> Ya hay una partida
          </p>
          <h2 className="mt-2 font-display text-2xl">Entra con un código</h2>
          <div className="mt-5 flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABC12"
              aria-label="Código de sala"
              autoCapitalize="characters"
              maxLength={6}
              className="field-input min-w-0 flex-1 font-display text-xl uppercase tracking-[0.25em]"
            />
            <button
              type="submit"
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-bold text-background hover:bg-foreground/90"
            >
              Entrar <ArrowRight className="size-4" />
            </button>
          </div>
          {joinError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {joinError}
            </p>
          )}
        </form>

        <ol className="grid gap-5 border-t border-border py-10 sm:grid-cols-3 md:border-l md:border-t-0 md:pl-10">
          {[
            ["01", "Crea", "Elige playlist y modo."],
            ["02", "Comparte", "Invita con el código."],
            ["03", "Juega", "Suma puntos al acertar."],
          ].map(([number, title, text]) => (
            <li key={number}>
              <span className="font-display text-sm text-primary">{number}</span>
              <h3 className="mt-3 text-sm font-bold">{title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="flex flex-col gap-4 py-7 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2">
          <Radio className="size-4 text-primary" aria-hidden="true" />
          Todas las canciones de la playlist. Nuevas rondas en cada partida.
        </p>
        <a
          href="https://shardix.pages.dev/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-foreground underline decoration-primary/50 underline-offset-4 hover:text-primary"
        >
          Página del creador <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </a>
      </footer>
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

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block space-y-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-sm font-bold">{title}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 shrink-0 accent-primary"
      />
    </label>
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
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <span className="text-sm font-bold tabular-nums">
          {value} <span className="text-xs font-normal text-muted-foreground">{suffix}</span>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </label>
  );
}
