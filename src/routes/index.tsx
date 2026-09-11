import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Music4, Radio, Type } from "lucide-react";

import { loadPlaylist } from "@/lib/game.functions";
import { getSpotifyClientId } from "@/lib/spotify.functions";
import {
  clearSession,
  connectSpotify,
  getSpotifyToken,
  isSpotifyConnected,
} from "@/lib/spotify";
import { db, getClientKey, getSavedName, makeCode, saveName, type GameMode } from "@/lib/room";

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

  const [name, setName] = useState("");
  const [playlist, setPlaylist] = useState("");
  const [mode, setMode] = useState<GameMode>("choice");
  const [rounds, setRounds] = useState(10);
  const [seconds, setSeconds] = useState(30);
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(getSavedName()), []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Escribe tu nombre.");
    if (!playlist.trim()) return setError("Pega el enlace de una playlist de Spotify.");
    setLoading(true);
    try {
      const data = await runLoadPlaylist({ data: { url: playlist.trim() } });
      if (data.tracks.length < 4) throw new Error("Esa playlist tiene muy pocas canciones.");

      const code = makeCode();
      const hostKey = getClientKey();
      saveName(name.trim());

      const { data: room, error: roomError } = await db
        .from("rooms")
        .insert({
          code,
          host_key: hostKey,
          playlist_name: data.name,
          playlist_image: data.image,
          tracks: data.tracks,
          rounds,
          seconds,
          mode,
        })
        .select()
        .single();
      if (roomError) throw roomError;

      const { error: playerError } = await db.from("players").insert({
        room_id: room.id,
        name: name.trim(),
        client_key: hostKey,
        is_host: true,
      });
      if (playerError) throw playerError;

      navigate({ to: "/sala/$code", params: { code } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo salió mal, inténtalo otra vez.");
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tu nombre">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="DJ Ana"
                maxLength={20}
                className="w-full rounded-xl border border-input bg-background/60 px-4 py-3 text-sm outline-none transition focus:border-primary"
              />
            </Field>
            <Field label="Playlist de Spotify">
              <input
                value={playlist}
                onChange={(e) => setPlaylist(e.target.value)}
                placeholder="https://open.spotify.com/playlist/..."
                className="w-full rounded-xl border border-input bg-background/60 px-4 py-3 text-sm outline-none transition focus:border-primary"
              />
            </Field>
          </div>

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
            </div>
          </Field>

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
            {loading ? "Leyendo la playlist…" : "Crear sala"}
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
            <li>· Funciona con playlists públicas de cualquier tamaño.</li>
            <li>· Se cargan todas las canciones de la playlist.</li>
            <li>· Cada partida elige canciones al azar, nunca las mismas.</li>
            <li>· La música suena sola hasta que se acaba el tiempo.</li>
          </ul>
        </div>
      </div>
    </main>
  );
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
