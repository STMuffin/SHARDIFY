import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Crown, Loader2, Play, Users, Volume2 } from "lucide-react";

import { PlaylistPicker } from "@/components/playlist-picker";
import { findPlayableTracks, loadPlaylist } from "@/lib/game.functions";
import { getSpotifyClientId } from "@/lib/spotify.functions";
import {
  fetchUserPlaylists,
  getSpotifyToken,
  isSpotifyConnected,
  playlistUrl,
  type UserPlaylist,
} from "@/lib/spotify";
import { isClose, nearMissHint } from "@/lib/match";
import { sfx } from "@/lib/sfx";
import {
  buildBlendTracks,
  computeRoundPoints,
  db,
  getClientKey,
  getPreviewSecondsForAttempt,
  getSavedName,
  isOwnerModeSchemaMissingError,
  saveName,
  shuffle,
  type GuessRow,
  type PlayerRow,
  type RoomRow,
  type RoundTrackRow,
  buildChoiceOptions,
} from "@/lib/room";

export const Route = createFileRoute("/sala/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sala de juego — SHARDIFY" },
      {
        name: "description",
        content: "Sala multijugador de SHARDIFY: adivina canciones de la playlist antes que nadie.",
      },
      { property: "og:title", content: "Sala de juego — SHARDIFY" },
      { property: "og:description", content: "Entra con el código y juega al blind test con tus amigos." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RoomPage,
});

const REVEAL_SECONDS = 6;

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

function RoomPage() {
  const { code } = Route.useParams();
  const runFindTracks = useServerFn(findPlayableTracks);
  const runLoadPlaylist = useServerFn(loadPlaylist);
  const runClientId = useServerFn(getSpotifyClientId);

  const [clientKey, setClientKey] = useState("");
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const [track, setTrack] = useState<RoundTrackRow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const [joinName, setJoinName] = useState("");
  const [joinTeam, setJoinTeam] = useState<"rojo" | "azul" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [replayNonce, setReplayNonce] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const advancingRef = useRef(false);
  const submittingAnswerRef = useRef(false);

  useEffect(() => {
    setClientKey(getClientKey());
    setJoinName(getSavedName());
  }, []);

  const teamTotals = useMemo(() => {
    if (!room?.team_battle) return [] as { team: string; total: number }[];
    const totals = new Map<string, number>();
    for (const player of players) {
      if (!player.team) continue;
      totals.set(player.team, (totals.get(player.team) ?? 0) + player.score);
    }
    return [...totals.entries()]
      .map(([team, total]) => ({ team, total }))
      .sort((a, b) => b.total - a.total);
  }, [players, room?.team_battle]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  // Sync with server clock so every player reveals the answer at the same time
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const url = import.meta.env['VITE_SUPABASE_URL'];
        if (!url) return;
        const started = Date.now();
        const res = await fetch(`${url}/rest/v1/`, { method: "HEAD" });
        const dateHeader = res.headers.get("date");
        if (!dateHeader || cancelled) return;
        const rtt = Date.now() - started;
        const serverNow = new Date(dateHeader).getTime() + rtt / 2;
        if (Number.isFinite(serverNow)) setClockOffset(serverNow - Date.now());
      } catch {
        /* keep local clock */
      }
    };
    void sync();
    const id = window.setInterval(() => void sync(), 60000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const loadRoom = useCallback(async () => {
    try {
      const { data, error } = await db.from("rooms").select("*").eq("code", code.toUpperCase()).maybeSingle();
      if (error) {
        throw error;
      }
      if (!data) {
        setNotFound(true);
        return null;
      }
      setRoom(data as RoomRow);
      return data as RoomRow;
    } catch (err) {
      console.error("loadRoom failed", err);
      setError(getErrorMessage(err, "No se pudo cargar la sala."));
      setNotFound(false);
      return null;
    }
  }, [code]);

  const loadPlayers = useCallback(async (roomId: string) => {
    try {
      const { data, error } = await db.from("players").select("*").eq("room_id", roomId).order("created_at");
      if (error) throw error;
      setPlayers((data ?? []) as PlayerRow[]);
    } catch (err) {
      console.error("loadPlayers failed", err);
      setError(getErrorMessage(err, "No se pudo cargar la lista de jugadores."));
    }
  }, []);

  const loadGuesses = useCallback(async (roomId: string) => {
    try {
      const { data, error } = await db.from("guesses").select("*").eq("room_id", roomId);
      if (error) throw error;
      setGuesses((data ?? []) as GuessRow[]);
    } catch (err) {
      console.error("loadGuesses failed", err);
      setError(getErrorMessage(err, "No se pudieron cargar las respuestas."));
    }
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

    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      await loadRoom();
      await loadPlayers(roomId);
      await loadGuesses(roomId);
    };

    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, 900);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [roomId, loadRoom, loadPlayers, loadGuesses]);

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
      if (cancelled) return;
      if (data) {
        setTrack(data as RoundTrackRow);
        return;
      }
      // Row not visible yet for this client: retry until it is
      retry = window.setTimeout(() => void fetchTrack(), 600);
    };
    let retry = 0;
    void fetchTrack();
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
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
  const triesAttempt = room?.mode === "tries" ? myRoundGuesses.length : 0;
  const roundDone =
    room?.mode === "choice" || room?.mode === "owner" || room?.mode === "chronology" || room?.mode === "blend"
      ? myRoundGuesses.length > 0
      : room?.mode === "tries"
        ? titleFound || artistFound || myRoundGuesses.length >= 4
        : titleFound && artistFound;
  const everyoneDone = useMemo(() => {
    if (!room || room.status !== "playing" || players.length === 0) return false;
    return players.every((p) => {
      const mine = guesses.filter(
        (g) => g.player_id === p.id && g.round_idx === room.current_round,
      );
      if (room.mode === "choice" || room.mode === "owner" || room.mode === "chronology" || room.mode === "blend") return mine.length > 0;
      if (room.mode === "tries") {
        return mine.length >= 4 || mine.some((g) => g.correct_title) || mine.some((g) => g.correct_artist);
      }
      return mine.some((g) => g.correct_title) && mine.some((g) => g.correct_artist);
    });
  }, [players, guesses, room]);

  // Countdown ticks in the last seconds of a round
  const lastTickRef = useRef(-1);
  useEffect(() => {
    if (room?.status !== "playing") return;
    const left = Math.ceil(remaining);
    if (left > 5) {
      lastTickRef.current = -1;
      return;
    }
    if (left > 0 && lastTickRef.current !== left) {
      lastTickRef.current = left;
      sfx.tick();
    } else if (left <= 0 && lastTickRef.current !== 0) {
      lastTickRef.current = 0;
      sfx.timeUp();
    }
  }, [remaining, room?.status]);

  // New round starts
  const lastRoundSoundRef = useRef<number | null>(null);
  useEffect(() => {
    if (!room || room.status !== "playing") return;
    if (lastRoundSoundRef.current === room.current_round) return;
    lastRoundSoundRef.current = room.current_round;
    sfx.roundStart();
  }, [room?.current_round, room?.status, room]);

  // Reveal of the answer
  const revealSoundRef = useRef(false);
  useEffect(() => {
    const isRevealing = room?.status === "playing" && remaining <= 0;
    if (isRevealing && !revealSoundRef.current) {
      revealSoundRef.current = true;
      sfx.reveal();
    } else if (!isRevealing) {
      revealSoundRef.current = false;
    }
  }, [remaining, room?.status]);

  // End of the game
  const finishedSoundRef = useRef(false);
  useEffect(() => {
    if (room?.status === "finished" && !finishedSoundRef.current) {
      finishedSoundRef.current = true;
      sfx.victory();
    } else if (room?.status !== "finished") {
      finishedSoundRef.current = false;
    }
  }, [room?.status]);

  // Someone joins the room
  const playerCountRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = playerCountRef.current;
    playerCountRef.current = players.length;
    if (prev !== null && players.length > prev) sfx.join();
  }, [players.length]);

  // Audio: autoplay each round, stop when the time is over
  const triesPreviewSeconds = room?.mode === "tries" ? getPreviewSecondsForAttempt(Math.min(myRoundGuesses.length, 3)) : null;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!track || room?.status !== "playing") {
      audio.pause();
      return;
    }

    const shouldLimitPreview = room?.mode === "tries" && typeof triesPreviewSeconds === "number";
    const datasetKey = shouldLimitPreview
      ? `tries-${track.idx}-${triesPreviewSeconds}-${replayNonce}`
      : `track-${track.idx}`;

    if (audio.dataset["key"] !== datasetKey) {
      audio.dataset["key"] = datasetKey;
      audio.src = track.preview_url;
      audio.loop = false;
      audio.currentTime = 0;
      audio.volume = 0.9;
      audio
        .play()
        .then(() => setAudioBlocked(false))
        .catch(() => setAudioBlocked(true));

      if (shouldLimitPreview) {
        const timeoutId = window.setTimeout(() => {
          audio.pause();
          audio.currentTime = 0;
        }, triesPreviewSeconds * 1000);
        return () => window.clearTimeout(timeoutId);
      }
    }
    return undefined;
  }, [track, room?.status, room?.mode, triesPreviewSeconds, myRoundGuesses.length, replayNonce]);

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
    if (room.team_battle && !joinTeam) {
      setError("Elige un equipo antes de entrar a la sala.");
      return;
    }
    setBusy(true);
    saveName(joinName.trim());
    const { error: joinError } = await db.from("players").insert({
      room_id: room.id,
      name: joinName.trim(),
      client_key: clientKey,
      is_host: room.host_key === clientKey,
      team: room.team_battle ? joinTeam : null,
    });
    if (joinError) setError("No se pudo entrar en la sala.");
    await loadPlayers(room.id);
    setBusy(false);
  }

  async function uploadPlayerPlaylist(urls: string[]) {
    if (!me || !urls.length) return;
    setBusy(true);
    setError(null);
    try {
      const { clientId } = await runClientId();
      const accessToken = await getSpotifyToken(clientId);
      const data = await runLoadPlaylist({ data: { urls, accessToken } });
      if (data.tracks.length < 4) throw new Error("Esa playlist tiene muy pocas canciones.");
      const { error: updateError } = await db
        .from("players")
        .update({ playlist_name: data.name, playlist_tracks: data.tracks })
        .eq("id", me.id);
      if (updateError) {
        if (isOwnerModeSchemaMissingError(updateError)) {
          throw new Error(
            "La migración de Supabase del modo '¿De quién es?' todavía no está aplicada en esta base de datos.",
          );
        }
        throw updateError;
      }
      await loadPlayers(me.room_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pude guardar tu playlist.");
    } finally {
      setBusy(false);
    }
  }

  async function changePlaylist(urls: string[]) {
    if (!room || !urls.length) return;
    setBusy(true);
    setError(null);
    try {
      const { clientId } = await runClientId();
      const accessToken = await getSpotifyToken(clientId);
      const data = await runLoadPlaylist({ data: { urls, accessToken } });
      if (data.tracks.length < 4) throw new Error("Esa playlist tiene muy pocas canciones.");
      await db
        .from("rooms")
        .update({
          playlist_name: data.name,
          playlist_image: data.image,
          tracks: data.tracks,
        })
        .eq("id", room.id);
      await loadRoom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pude leer esa playlist.");
    } finally {
      setBusy(false);
    }
  }

  async function startGame() {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      await db.from("rooms").update({ status: "loading" }).eq("id", room.id);
      const allTracks =
        room.mode === "owner"
          ? shuffle(
              players.flatMap((player) =>
                shuffle((player.playlist_tracks ?? []).map((track) => ({
                  ...track,
                  sourcePlayerName: player.name,
                }))),
              ),
            )
          : room.mode === "blend"
            ? shuffle(buildBlendTracks(players))
            : room.tracks ?? [];
      if ((room.mode === "owner" || room.mode === "blend") && players.some((player) => !player.playlist_tracks?.length)) {
        throw new Error("Todos los jugadores deben cargar una playlist antes de empezar.");
      }
      const pool = shuffle(allTracks);
      const candidates = pool
        .filter((track) => room.mode !== "chronology" || Boolean(track.releaseDate))
        .slice(0, Math.min(pool.length, room.rounds * 4));
      if (room.mode === "chronology" && candidates.length < 2) {
        throw new Error("El modo Cronología necesita canciones con fecha de lanzamiento.");
      }
      const { tracks: playable } = await runFindTracks({
        data: { candidates, need: room.rounds },
      });
      if (!playable.length) throw new Error("No encontré audio para las canciones de esta playlist.");

      const rows = playable.map((t, idx) => {
        const chronologyReference =
          room.mode === "chronology"
            ? shuffle(
                allTracks.filter(
                  (candidate) => candidate.title !== t.title && Boolean(candidate.releaseDate),
                ),
              )[0]
            : null;
        const chronologyBefore = Boolean(
          chronologyReference &&
            t.releaseDate &&
            chronologyReference.releaseDate &&
            t.releaseDate < chronologyReference.releaseDate,
        );
        const options =
          room.mode === "chronology" && chronologyReference
            ? [
                chronologyBefore
                  ? `Antes de «${chronologyReference.title}»`
                  : `Después de «${chronologyReference.title}»`,
                chronologyBefore
                  ? `Después de «${chronologyReference.title}»`
                  : `Antes de «${chronologyReference.title}»`,
              ]
            : room.mode === "owner"
            ? shuffle([
                (t as { sourcePlayerName?: string }).sourcePlayerName ?? "",
                ...shuffle(
                  [
                    ...new Set(
                      allTracks
                        .map((o) => (o as { sourcePlayerName?: string }).sourcePlayerName)
                        .filter(
                          (name): name is string =>
                            Boolean(name) &&
                            name !== (t as { sourcePlayerName?: string }).sourcePlayerName,
                        ),
                    ),
                  ],
                ).slice(0, 3),
              ])
            : buildChoiceOptions(t, allTracks);
        return {
          room_id: room.id,
          idx,
          title: t.title,
          artist: t.artist,
          preview_url: t.previewUrl,
          cover: t.cover,
          options,
          source_player_name: t.sourcePlayerName ?? null,
        };
      });

      const { error: insertError } = await db.from("round_tracks").insert(rows);
      if (insertError) {
        if (isOwnerModeSchemaMissingError(insertError)) {
          throw new Error(
            "La base de datos aún no tiene la columna source_player_name. Ejecuta la migración de Supabase antes de jugar en modo propietario.",
          );
        }
        throw insertError;
      }

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

  // Everyone answered: cut the timer short so the result shows right away
  const cuttingRef = useRef(false);
  useEffect(() => {
    if (!room || !isHost || room.status !== "playing") return;
    if (!everyoneDone || revealing || cuttingRef.current) return;
    cuttingRef.current = true;
    void (async () => {
      await db
        .from("rooms")
        .update({ round_started_at: new Date(Date.now() - seconds * 1000).toISOString() })
        .eq("id", room.id);
      await loadRoom();
      cuttingRef.current = false;
    })();
  }, [room, isHost, everyoneDone, revealing, seconds, loadRoom]);



  async function submitAnswer(payload: { text: string } | { option: string }) {
    if (!room || !me || !track || revealing || roundDone || submittingAnswerRef.current) return;
    let titleOk = false;
    let artistOk = false;
    let answer = "";

    if (room.mode === "owner" && "option" in payload) {
      answer = payload.option;
      titleOk = payload.option === track.source_player_name;
      artistOk = titleOk;
    } else if ("option" in payload) {
      answer = payload.option;
      titleOk = room.mode === "chronology"
        ? payload.option === track.options[0]
        : payload.option === `${track.title} — ${track.artist}`;
      artistOk = titleOk;
    } else {
      answer = payload.text.trim();
      if (answer.length < 2) return;
      titleOk = !titleFound && isClose(answer, track.title);
      artistOk = !artistFound && isClose(answer, track.artist);
    }

    submittingAnswerRef.current = true;
    const points = computeRoundPoints({
      titleCorrect: titleOk,
      artistCorrect: artistOk,
      remaining,
      totalSeconds: seconds,
      isOwnerGuess: room.mode === "owner",
      ...(room.mode === "tries" ? { attemptIndex: myRoundGuesses.length } : {}),
    });

    if (titleOk && artistOk) sfx.correct();
    else if (titleOk || artistOk) sfx.partial();
    else if (
      "text" in payload &&
      nearMissHint(answer, track.title, track.artist, titleFound, artistFound)
    )
      sfx.near();
    else sfx.wrong();

    try {
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
    } finally {
      submittingAnswerRef.current = false;
    }
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
          {room.team_battle && (
            <div className="space-y-2 text-left">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Equipo</label>
              <div className="grid grid-cols-2 gap-2">
                {(["rojo", "azul"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setJoinTeam(option)}
                    className={`rounded-xl border px-3 py-2 text-sm font-bold ${
                      joinTeam === option
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background/40 text-muted-foreground"
                    }`}
                  >
                    {option === "rojo" ? "Rojo" : "Azul"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            type="submit"
            disabled={busy || (room.team_battle && !joinTeam)}
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
            SHARDIFY
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
              players={players}
              me={me}
              total={room.tracks?.length ?? 0}
              playlistName={room.playlist_name}
              onStart={startGame}
              onChangePlaylist={changePlaylist}
              onUploadPlayerPlaylist={uploadPlayerPlaylist}
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
              onReplay={() => setReplayNonce((value) => value + 1)}
            />
          )}

          {room.status === "finished" && (
            <div className="text-center">
              <h2 className="font-display text-3xl font-bold">Fin de la partida</h2>
              {room.team_battle ? (
                <ol className="mt-6 space-y-3 text-left">
                  {teamTotals.map((team, i) => (
                    <li
                      key={team.team}
                      className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-4 py-3"
                    >
                      <span className="flex items-center gap-3">
                        <span className="font-display text-lg font-bold text-primary">{i + 1}</span>
                        Equipo {team.team}
                      </span>
                      <span className="font-display font-bold">{team.total} pts</span>
                    </li>
                  ))}
                </ol>
              ) : (
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
              )}
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
            {room.team_battle ? "Equipos" : "Marcador"}
          </h3>
          <ul className="mt-4 space-y-2">
            {room.team_battle
              ? teamTotals.map((team) => (
                  <li key={team.team} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <span className="font-display font-bold text-foreground">Equipo {team.team}</span>
                    </span>
                    <span className="font-display font-bold text-foreground">{team.total}</span>
                  </li>
                ))
              : ranked.map((p) => {
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
  players,
  me,
  total,
  playlistName,
  onStart,
  onChangePlaylist,
  onUploadPlayerPlaylist,
  error,
}: {
  isHost: boolean;
  busy: boolean;
  rounds: number;
  seconds: number;
  mode: string;
  players: PlayerRow[];
  me: PlayerRow;
  total: number;
  playlistName: string;
  onStart: () => void;
  onChangePlaylist: (urls: string[]) => void;
  onUploadPlayerPlaylist: (urls: string[]) => void;
  error: string | null;
}) {
  const runClientId = useServerFn(getSpotifyClientId);
  const [newPlaylist, setNewPlaylist] = useState("");
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const spotify = isSpotifyConnected();
  const canUploadPlaylist = mode === "owner" || mode === "blend" || isHost;

  useEffect(() => {
    if (!canUploadPlaylist || !spotify) {
      setPlaylists([]);
      setSelected(new Set());
      return;
    }
    let cancelled = false;
    setPlaylistsLoading(true);
    void (async () => {
      try {
        const { clientId } = await runClientId();
        const token = await getSpotifyToken(clientId);
        if (!token) return;
        const list = await fetchUserPlaylists(token);
        if (!cancelled) setPlaylists(list);
      } catch {
        if (!cancelled) setPlaylists([]);
      } finally {
        if (!cancelled) setPlaylistsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canUploadPlaylist, spotify, runClientId]);

  function togglePlaylist(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyPlaylists() {
    const urls = [...[...selected].map(playlistUrl), ...(newPlaylist.trim() ? [newPlaylist.trim()] : [])];
    if (!urls.length) return;
    if (mode === "owner" || mode === "blend") onUploadPlayerPlaylist(urls);
    else onChangePlaylist(urls);
    setNewPlaylist("");
    setSelected(new Set());
  }

  return (

    <div className="text-center">
      <h2 className="font-display text-3xl font-bold">Sala de espera</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Comparte el código para que entren tus amigos.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Canciones" value={String(rounds)} />
        <Stat label="Segundos" value={String(seconds)} />
        <Stat
          label="Modo"
          value={
            mode === "choice"
              ? "Opción múltiple"
              : mode === "blend"
                ? "Blend"
                : mode === "owner"
                  ? "¿De quién es?"
                  : mode === "tries"
                    ? "4 intentos"
                    : mode === "chronology"
                      ? "Cronología"
                      : "Escribir"
          }
        />
      </div>
      {mode === "owner" || mode === "blend" ? (
        <div className="mt-4 space-y-3 rounded-xl border border-border bg-background/40 p-4 text-left">
          {mode === "blend" ? (
            <>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Mezcla de playlists
              </p>
              <div className="space-y-2 text-sm text-muted-foreground">
                {players
                  .filter((player) => player.playlist_tracks?.length)
                  .map((player) => (
                    <div key={player.id} className="flex items-center justify-between gap-3 rounded-lg bg-background/50 px-3 py-2">
                      <span className="font-medium text-foreground">{player.name}</span>
                      <span>{player.playlist_tracks?.length ?? 0} canciones</span>
                    </div>
                  ))}
              </div>
              <p className="text-xs text-muted-foreground">
                La app deduplica canciones repetidas y genera una playlist común antes de empezar.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {players.filter((player) => player.playlist_tracks?.length).length}/{players.length} jugadores ya cargaron su playlist.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          <strong className="text-foreground">{playlistName}</strong> · {total} canciones cargadas ·
          se sortean nuevas cada partida
        </p>
      )}
      {canUploadPlaylist && (
        <div className="mx-auto mt-5 max-w-md space-y-3 text-left">
          {spotify && (
            <PlaylistPicker
              playlists={playlists}
              loading={playlistsLoading}
              selected={selected}
              onToggle={togglePlaylist}
            />
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              applyPlaylists();
            }}
            className="flex gap-2"
          >
            <input
              value={newPlaylist}
              onChange={(e) => setNewPlaylist(e.target.value)}
              placeholder={spotify ? "O pega un enlace…" : "Pega un enlace de playlist…"}
              className="flex-1 rounded-xl border border-input bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-bold disabled:opacity-60"
            >
              {mode === "owner" || mode === "blend" ? "Cargar playlist" : "Cambiar"}
            </button>
          </form>
        </div>
      )}

      {isHost ? (
        <button
          onClick={onStart}
          disabled={busy || ((mode === "owner" || mode === "blend") && players.some((player) => !player.playlist_tracks?.length))}
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
  onReplay,
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
  onReplay: () => void;
}) {
  const [text, setText] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText("");
  }, [room.current_round]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [myGuesses.length]);

  // Visual feedback on the last guess: green flash on a hit, shake on a miss.
  const [pulse, setPulse] = useState<"ok" | "bad" | null>(null);
  const lastGuessIdRef = useRef<string | null>(null);
  useEffect(() => {
    const last = myGuesses[myGuesses.length - 1];
    if (!last || lastGuessIdRef.current === last.id) return;
    const first = lastGuessIdRef.current === null;
    lastGuessIdRef.current = last.id;
    if (first) return;
    setPulse(last.correct_title || last.correct_artist ? "ok" : "bad");
    const t = window.setTimeout(() => setPulse(null), 650);
    return () => window.clearTimeout(t);
  }, [myGuesses]);


  if (!track) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  const progress = Math.max(0, Math.min(1, remaining / room.seconds));
  const triesAttempt = room.mode === "tries" ? Math.min(myGuesses.length + 1, 4) : 0;
  const triesPreview = room.mode === "tries" ? getPreviewSecondsForAttempt(Math.min(myGuesses.length, 3)) : null;

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

      {room.mode === "tries" && !revealing && (
        <div className="mt-4 flex items-center justify-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
          <span>Intento {triesAttempt}/4 • escucha {triesPreview}s</span>
          <button
            type="button"
            onClick={onReplay}
            className="inline-flex items-center gap-1 rounded-lg border border-primary/40 px-2 py-1 text-primary transition hover:bg-primary/10"
            aria-label="Reproducir de nuevo la pista"
          >
            <Volume2 className="size-3.5" /> Repetir
          </button>
        </div>
      )}

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
            {(room.mode === "owner" || room.mode === "blend") && track.source_player_name && (
              <p className="mt-3 text-sm font-bold text-primary">
                {room.mode === "blend"
                  ? `Aportada por ${track.source_player_name}`
                  : `La playlist era de ${track.source_player_name}`}
              </p>
            )}
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
          {room.mode === "owner" ? (
            <div>
              <p className="mb-4 text-center text-sm font-semibold text-muted-foreground">
                ¿De quién es esta playlist?
              </p>
              {myGuesses.length > 0 ? (
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
              )}
            </div>
          ) : room.mode === "choice" || room.mode === "chronology" || room.mode === "blend" ? (
            myGuesses.length > 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                Respuesta enviada. Espera al resto…
              </p>
            ) : (
              <div>
                {room.mode === "chronology" && (
                  <p className="mb-4 text-center text-sm font-semibold text-muted-foreground">
                    ¿Esta canción salió antes o después de la referencia?
                  </p>
                )}
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
              </div>
            )
          ) : room.mode === "tries" ? (
            myGuesses.length >= 4 || titleFound || artistFound ? (
              <p className="text-center text-sm text-muted-foreground">
                {titleFound || artistFound ? "¡Correcto!" : "Se acabaron los intentos."}
              </p>
            ) : (
              <div className="rounded-2xl border border-border bg-background/40 p-4">
                <p className="mb-4 text-center text-sm text-muted-foreground">
                  Tienes {4 - myGuesses.length} intentos restantes. Cada fallo alarga la pista y baja los puntos.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onAnswer({ text });
                    setText("");
                  }}
                  className="flex gap-2"
                >
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    autoFocus
                    placeholder="Escribe la canción o el artista…"
                    className="flex-1 rounded-xl border border-input bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    className="glow rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground"
                  >
                    Enviar
                  </button>
                </form>
              </div>
            )
          ) : (
            <div
              className={`rounded-2xl border bg-background/40 p-4 transition-colors ${
                pulse === "ok"
                  ? "border-primary flash-ok"
                  : pulse === "bad"
                    ? "border-destructive shake"
                    : "border-border"
              }`}
            >
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
                {myGuesses.map((g, i) => {
                  const hit = g.correct_title || g.correct_artist;
                  // Progress up to this message, so the hint matches that moment.
                  const before = myGuesses.slice(0, i);
                  const hint = hit
                    ? null
                    : nearMissHint(
                        g.answer,
                        track.title,
                        track.artist,
                        before.some((p) => p.correct_title),
                        before.some((p) => p.correct_artist),
                      );
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
                      {hint && (
                        <span className="max-w-[85%] rounded-2xl rounded-bl-sm bg-secondary px-4 py-2 text-xs font-medium text-foreground">
                          🔥 {hint}
                        </span>
                      )}
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
                    sfx.send();
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
