import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Crown, Loader2, Play, Users, Volume2 } from "lucide-react";

import { findPlayableTracks } from "@/lib/game.functions";
import { isClose } from "@/lib/match";
import {
  db,
  getClientKey,
  getSavedName,
  saveName,
  shuffle,
  type GuessRow,
  type PlayerRow,
  type RoomRow,
  type RoundTrackRow,
} from "@/lib/room";

export const Route = createFileRoute("/sala/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sala de juego — Blind Beat" },
      {
        name: "description",
        content: "Sala multijugador de Blind Beat: adivina canciones de la playlist antes que nadie.",
      },
      { property: "og:title", content: "Sala de juego — Blind Beat" },
      { property: "og:description", content: "Entra con el código y juega al blind test con tus amigos." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RoomPage,
});

const REVEAL_SECONDS = 6;

function RoomPage() {
  const { code } = Route.useParams();
  const runFindTracks = useServerFn(findPlayableTracks);

  const [clientKey, setClientKey] = useState("");
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const [track, setTrack] = useState<RoundTrackRow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notFound, setNotFound] = useState(false);
  const [joinName, setJoinName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const advancingRef = useRef(false);

  useEffect(() => {
    setClientKey(getClientKey());
    setJoinName(getSavedName());
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  const loadRoom = useCallback(async () => {
    const { data } = await db.from("rooms").select("*").eq("code", code.toUpperCase()).maybeSingle();
    if (!data) {
      setNotFound(true);
      return null;
    }
    setRoom(data as RoomRow);
    return data as RoomRow;
  }, [code]);

  const loadPlayers = useCallback(async (roomId: string) => {
    const { data } = await db.from("players").select("*").eq("room_id", roomId).order("created_at");
    setPlayers((data ?? []) as PlayerRow[]);
  }, []);

  const loadGuesses = useCallback(async (roomId: string) => {
    const { data } = await db.from("guesses").select("*").eq("room_id", roomId);
    setGuesses((data ?? []) as GuessRow[]);
  }, []);

  useEffect(() => {
    void (async () => {
      const found = await loadRoom();
      if (found) {
        await loadPlayers(found.id);
        await loadGuesses(found.id);
      }
    })();
  }, [loadRoom, loadPlayers, loadGuesses]);

  const roomId = room?.id;

  useEffect(() => {
    if (!roomId) return;
    const channel = (db.channel(`room-${roomId}`) as any)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        // Large unchanged columns (tracks) are omitted from realtime payloads,
        // so merge onto the previous row instead of replacing it.
        (payload: { new: Partial<RoomRow> }) =>
          setRoom((prev) => ({ ...(prev as RoomRow), ...payload.new }) as RoomRow),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
        () => void loadPlayers(roomId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guesses", filter: `room_id=eq.${roomId}` },
        () => void loadGuesses(roomId),
      )
      .subscribe();
    return () => {
      void db.removeChannel(channel);
    };
  }, [roomId, loadPlayers, loadGuesses]);

  // Current round track
  useEffect(() => {
    if (!room || room.status !== "playing" || room.current_round < 0) {
      setTrack(null);
      return;
    }
    let cancelled = false;
    const fetchTrack = async () => {
      const { data } = await db
        .from("round_tracks")
        .select("*")
        .eq("room_id", room.id)
        .eq("idx", room.current_round)
        .maybeSingle();
      if (!cancelled && data) setTrack(data as RoundTrackRow);
    };
    void fetchTrack();
    return () => {
      cancelled = true;
    };
  }, [room?.id, room?.status, room?.current_round]);

  const me = useMemo(
    () => players.find((p) => p.client_key === clientKey) ?? null,
    [players, clientKey],
  );
  const isHost = Boolean(me?.is_host);
  const seconds = room?.seconds ?? 30;
  const elapsed = room?.round_started_at
    ? (now - new Date(room.round_started_at).getTime()) / 1000
    : 0;
  const remaining = Math.max(0, seconds - elapsed);
  const revealing = room?.status === "playing" && remaining <= 0;
  const myRoundGuesses = useMemo(
    () =>
      guesses
        .filter((g) => g.player_id === me?.id && g.round_idx === (room?.current_round ?? -1))
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [guesses, me?.id, room?.current_round],
  );
  const titleFound = myRoundGuesses.some((g) => g.correct_title);
  const artistFound = myRoundGuesses.some((g) => g.correct_artist);
  const roundPoints = myRoundGuesses.reduce((sum, g) => sum + g.points, 0);
  const roundDone =
    room?.mode === "choice" ? myRoundGuesses.length > 0 : titleFound && artistFound;
  const everyoneDone = useMemo(() => {
    if (!room || room.status !== "playing" || players.length === 0) return false;
    return players.every((p) => {
      const mine = guesses.filter(
        (g) => g.player_id === p.id && g.round_idx === room.current_round,
      );
      if (room.mode === "choice") return mine.length > 0;
      return mine.some((g) => g.correct_title) && mine.some((g) => g.correct_artist);
    });
  }, [players, guesses, room]);

  // Audio: autoplay each round, stop when the time is over
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!track || room?.status !== "playing") {
      audio.pause();
      return;
    }
    if (audio.dataset["idx"] !== String(track.idx)) {
      audio.dataset["idx"] = String(track.idx);
      audio.src = track.preview_url;
      audio.loop = true;
      audio.currentTime = 0;
      audio.volume = 0.9;
      audio
        .play()
        .then(() => setAudioBlocked(false))
        .catch(() => setAudioBlocked(true));
    }
  }, [track, room?.status]);

  useEffect(() => {
    if (revealing || room?.status !== "playing") audioRef.current?.pause();
  }, [revealing, room?.status]);

  async function unlockAudio() {
    try {
      await audioRef.current?.play();
      setAudioBlocked(false);
    } catch {
      setAudioBlocked(true);
    }
  }

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    if (!room || !joinName.trim()) return;
    setBusy(true);
    saveName(joinName.trim());
    const { error: joinError } = await db.from("players").insert({
      room_id: room.id,
      name: joinName.trim(),
      client_key: clientKey,
      is_host: room.host_key === clientKey,
    });
    if (joinError) setError("No se pudo entrar en la sala.");
    await loadPlayers(room.id);
    setBusy(false);
  }

  async function startGame() {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      await db.from("rooms").update({ status: "loading" }).eq("id", room.id);
      const allTracks = room.tracks ?? [];
      const pool = shuffle(allTracks);
      const candidates = pool.slice(0, Math.min(pool.length, room.rounds * 4));
      const { tracks: playable } = await runFindTracks({
        data: { candidates, need: room.rounds },
      });
      if (!playable.length) throw new Error("No encontré audio para las canciones de esta playlist.");

      const rows = playable.map((t, idx) => {
        const wrong = shuffle(
          allTracks.filter((o) => o.title.toLowerCase() !== t.title.toLowerCase()),
        )
          .slice(0, 3)
          .map((o) => `${o.title} — ${o.artist}`);
        const options = shuffle([`${t.title} — ${t.artist}`, ...wrong]);
        return {
          room_id: room.id,
          idx,
          title: t.title,
          artist: t.artist,
          preview_url: t.previewUrl,
          cover: t.cover,
          options,
        };
      });

      const { error: insertError } = await db.from("round_tracks").insert(rows);
      if (insertError) throw insertError;

      await db
        .from("rooms")
        .update({
          status: "playing",
          rounds: rows.length,
          current_round: 0,
          round_started_at: new Date().toISOString(),
        })
        .eq("id", room.id);
      await loadRoom();
    } catch (err) {
      await db.from("rooms").update({ status: "lobby" }).eq("id", room.id);
      setError(err instanceof Error ? err.message : "No se pudo empezar la partida.");
    } finally {
      setBusy(false);
    }
  }

  // Host advances rounds automatically after the reveal
  useEffect(() => {
    if (!room || !isHost || room.status !== "playing") return;
    if (elapsed < seconds + REVEAL_SECONDS || advancingRef.current) return;
    advancingRef.current = true;
    void (async () => {
      const next = room.current_round + 1;
      if (next >= room.rounds) {
        await db.from("rooms").update({ status: "finished" }).eq("id", room.id);
      } else {
        await db
          .from("rooms")
          .update({ current_round: next, round_started_at: new Date().toISOString() })
          .eq("id", room.id);
      }
      await loadRoom();
      advancingRef.current = false;
    })();
  }, [room, isHost, elapsed, seconds, loadRoom]);

  async function submitAnswer(payload: { text: string } | { option: string }) {
    if (!room || !me || !track || revealing || roundDone) return;
    const factor = 0.4 + 0.6 * (remaining / seconds);
    let titleOk = false;
    let artistOk = false;
    let answer = "";
    let base = 0;

    if ("option" in payload) {
      answer = payload.option;
      titleOk = payload.option === `${track.title} — ${track.artist}`;
      artistOk = titleOk;
      base = titleOk ? 1000 : 0;
    } else {
      answer = payload.text.trim();
      if (!answer) return;
      // A single chat message can match the song title or the artist.
      titleOk = !titleFound && isClose(answer, track.title);
      artistOk = !artistFound && isClose(answer, track.artist);
      base = (titleOk ? 600 : 0) + (artistOk ? 400 : 0);
    }

    const points = Math.round(base * factor);

    await db.from("guesses").insert({
      room_id: room.id,
      round_idx: room.current_round,
      player_id: me.id,
      answer,
      correct_title: titleOk,
      correct_artist: artistOk,
      points,
    });
    if (points > 0) {
      await db.from("players").update({ score: me.score + points }).eq("id", me.id);
    }
    await loadGuesses(room.id);
    await loadPlayers(room.id);
  }


  async function playAgain() {
    if (!room) return;
    setBusy(true);
    await db.from("guesses").delete().eq("room_id", room.id);
    await db.from("round_tracks").delete().eq("room_id", room.id);
    await db.from("players").update({ score: 0 }).eq("room_id", room.id);
    await db
      .from("rooms")
      .update({ status: "lobby", current_round: -1, round_started_at: null })
      .eq("id", room.id);
    await loadRoom();
    await loadPlayers(room.id);
    await loadGuesses(room.id);
    setBusy(false);
  }

  if (notFound) {
    return (
      <Centered>
        <h1 className="text-3xl font-bold">Sala no encontrada</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          El código <strong>{code}</strong> no existe o la partida ya se cerró.
        </p>
        <Link to="/" className="mt-6 inline-block rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">
          Volver al inicio
        </Link>
      </Centered>
    );
  }

  if (!room) {
    return (
      <Centered>
        <Loader2 className="size-8 animate-spin text-primary" />
      </Centered>
    );
  }

  if (!me) {
    return (
      <Centered>
        <form onSubmit={handleJoin} className="panel w-full max-w-sm space-y-5 p-8">
          <div>
            <h1 className="text-2xl font-bold">Sala {room.code}</h1>
            <p className="text-sm text-muted-foreground">{room.playlist_name}</p>
          </div>
          <input
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
            placeholder="Tu nombre"
            maxLength={20}
            className="w-full rounded-xl border border-input bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={busy}
            className="glow w-full rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
          >
            Entrar a jugar
          </button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </Centered>
    );
  }

  const ranked = [...players].sort((a, b) => b.score - a.score);

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <audio ref={audioRef} playsInline className="hidden" />

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/" className="font-display text-lg font-bold text-gradient">
            Blind Beat
          </Link>
          <p className="text-sm text-muted-foreground">{room.playlist_name}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="rounded-xl border border-border bg-card/60 px-4 py-2 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Código</p>
            <p className="font-display text-xl font-bold tracking-[0.3em] text-primary">{room.code}</p>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="size-4" /> {players.length}
          </div>
        </div>
      </header>

      {audioBlocked && room.status === "playing" && (
        <button
          onClick={unlockAudio}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 py-3 text-sm font-bold text-primary"
        >
          <Volume2 className="size-4" /> Toca aquí para activar el sonido
        </button>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section className="panel p-6 sm:p-8">
          {room.status === "lobby" && (
            <Lobby
              isHost={isHost}
              busy={busy}
              rounds={room.rounds}
              seconds={room.seconds}
              mode={room.mode}
              total={room.tracks?.length ?? 0}
              onStart={startGame}
              error={error}
            />
          )}

          {room.status === "loading" && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="font-display text-lg font-bold">Preparando canciones al azar…</p>
              <p className="text-sm text-muted-foreground">Buscando los fragmentos de audio.</p>
            </div>
          )}

          {room.status === "playing" && (
            <RoundView
              room={room}
              track={track}
              remaining={remaining}
              revealing={revealing}
              myGuesses={myRoundGuesses}
              titleFound={titleFound}
              artistFound={artistFound}
              roundPoints={roundPoints}
              roundDone={roundDone}
              onAnswer={submitAnswer}
            />
          )}

          {room.status === "finished" && (
            <div className="text-center">
              <h2 className="font-display text-3xl font-bold">Fin de la partida</h2>
              <ol className="mt-6 space-y-3 text-left">
                {ranked.map((p, i) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-4 py-3"
                  >
                    <span className="flex items-center gap-3">
                      <span className="font-display text-lg font-bold text-primary">{i + 1}</span>
                      {p.name}
                    </span>
                    <span className="font-display font-bold">{p.score} pts</span>
                  </li>
                ))}
              </ol>
              {isHost && (
                <button
                  onClick={playAgain}
                  disabled={busy}
                  className="glow mt-6 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
                >
                  Jugar otra vez
                </button>
              )}
            </div>
          )}
        </section>

        <aside className="panel h-fit p-6">
          <h3 className="font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Marcador
          </h3>
          <ul className="mt-4 space-y-2">
            {ranked.map((p) => {
              const answered = guesses.some(
                (g) => g.player_id === p.id && g.round_idx === room.current_round,
              );
              return (
                <li
                  key={p.id}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                    p.id === me.id ? "bg-primary/10 text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {p.is_host && <Crown className="size-3.5 text-accent" />}
                    {p.name}
                    {room.status === "playing" && answered && (
                      <span className="size-1.5 rounded-full bg-primary" />
                    )}
                  </span>
                  <span className="font-display font-bold text-foreground">{p.score}</span>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </main>
  );
}

function Lobby({
  isHost,
  busy,
  rounds,
  seconds,
  mode,
  total,
  onStart,
  error,
}: {
  isHost: boolean;
  busy: boolean;
  rounds: number;
  seconds: number;
  mode: string;
  total: number;
  onStart: () => void;
  error: string | null;
}) {
  return (
    <div className="text-center">
      <h2 className="font-display text-3xl font-bold">Sala de espera</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Comparte el código para que entren tus amigos.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Canciones" value={String(rounds)} />
        <Stat label="Segundos" value={String(seconds)} />
        <Stat label="Modo" value={mode === "choice" ? "Opción múltiple" : "Escribir"} />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        {total} canciones cargadas de la playlist · se sortean nuevas cada partida
      </p>
      {isHost ? (
        <button
          onClick={onStart}
          disabled={busy}
          className="glow mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
        >
          <Play className="size-4" /> Empezar partida
        </button>
      ) : (
        <p className="mt-8 text-sm text-muted-foreground">Esperando al anfitrión…</p>
      )}
      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function RoundView({
  room,
  track,
  remaining,
  revealing,
  myGuesses,
  titleFound,
  artistFound,
  roundPoints,
  roundDone,
  onAnswer,
}: {
  room: RoomRow;
  track: RoundTrackRow | null;
  remaining: number;
  revealing: boolean;
  myGuesses: GuessRow[];
  titleFound: boolean;
  artistFound: boolean;
  roundPoints: number;
  roundDone: boolean;
  onAnswer: (payload: { text: string } | { option: string }) => void;
}) {
  const [text, setText] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText("");
  }, [room.current_round]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [myGuesses.length]);


  if (!track) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  const progress = Math.max(0, Math.min(1, remaining / room.seconds));

  return (
    <div>
      <div className="flex items-center justify-between text-xs uppercase tracking-widest text-muted-foreground">
        <span>
          Ronda {room.current_round + 1} / {room.rounds}
        </span>
        <span className="font-display text-2xl font-bold text-primary">
          {Math.ceil(remaining)}s
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="mt-8 flex flex-col items-center">
        {revealing ? (
          <div className="text-center">
            {track.cover && (
              <img
                src={track.cover}
                alt={`Portada de ${track.title}`}
                className="mx-auto size-40 rounded-2xl object-cover"
              />
            )}
            <p className="mt-4 font-display text-2xl font-bold">{track.title}</p>
            <p className="text-sm text-muted-foreground">{track.artist}</p>
            <p
              className={`mt-4 text-sm font-bold ${
                roundPoints > 0 ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {roundPoints > 0 ? `+${roundPoints} puntos` : "Sin puntos esta ronda"}
            </p>
          </div>
        ) : (
          <div className="flex h-40 items-end gap-1.5">
            {Array.from({ length: 9 }).map((_, i) => (
              <span
                key={i}
                className="equalizer-bar w-3 rounded-full bg-primary/80"
                style={{ height: "100%", animationDelay: `${i * 110}ms` }}
              />
            ))}
          </div>
        )}
      </div>

      {!revealing && (
        <div className="mt-8">
          {room.mode === "choice" ? (
            myGuesses.length > 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                Respuesta enviada. Espera al resto…
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {track.options.map((option) => (
                  <button
                    key={option}
                    onClick={() => onAnswer({ option })}
                    className="rounded-xl border border-border bg-background/40 px-4 py-4 text-left text-sm font-medium transition hover:border-primary hover:bg-primary/10"
                  >
                    {option}
                  </button>
                ))}
              </div>
            )
          ) : (
            <div className="rounded-2xl border border-border bg-background/40 p-4">
              <div className="flex gap-2 text-xs font-bold uppercase tracking-widest">
                <span
                  className={`rounded-full px-3 py-1 ${
                    titleFound
                      ? "bg-primary/20 text-primary"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {titleFound ? "Canción ✓" : "Canción ?"}
                </span>
                <span
                  className={`rounded-full px-3 py-1 ${
                    artistFound
                      ? "bg-primary/20 text-primary"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {artistFound ? "Artista ✓" : "Artista ?"}
                </span>
              </div>

              <div className="mt-4 max-h-52 space-y-2 overflow-y-auto pr-1">
                {myGuesses.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Escribe lo que creas: el título o el artista. Detecto cuál acertaste.
                  </p>
                )}
                {myGuesses.map((g) => {
                  const hit = g.correct_title || g.correct_artist;
                  return (
                    <div key={g.id} className="flex flex-col items-end gap-1">
                      <span className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                        {g.answer}
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          hit ? "text-primary" : "text-muted-foreground"
                        }`}
                      >
                        {g.correct_title && g.correct_artist
                          ? `¡Canción y artista! +${g.points}`
                          : g.correct_title
                            ? `¡Título correcto! +${g.points}`
                            : g.correct_artist
                              ? `¡Artista correcto! +${g.points}`
                              : "Nop, sigue intentando"}
                      </span>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              {roundDone ? (
                <p className="mt-4 text-center text-sm font-bold text-primary">
                  ¡Completado! Espera a la siguiente ronda…
                </p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onAnswer({ text });
                    setText("");
                  }}
                  className="mt-4 flex gap-2"
                >
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    autoFocus
                    placeholder={
                      titleFound ? "¿Quién la canta?" : artistFound ? "¿Cómo se llama?" : "Escribe canción o artista…"
                    }
                    className="flex-1 rounded-xl border border-input bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    className="glow rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground"
                  >
                    Enviar
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="font-display text-lg font-bold">{value}</p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-5 text-center">
      {children}
    </main>
  );
}
