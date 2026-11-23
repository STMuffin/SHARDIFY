import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Crown, Loader2, Music2, Play, Send, Users, Volume2, WifiOff } from "lucide-react";

import { AnimatedScore } from "@/components/animated-score";
import { GameResults } from "@/components/game-results";
import { Button } from "@/components/ui/button";
import { RoomShare } from "@/components/room-share";
import { RoomChat } from "@/components/room-chat";
import { PlayerPhotos, PlayerPhoto, ProfilePhotoUpload } from "@/components/player-photo";
import { getMusicVolume, MUSIC_VOLUME_EVENT } from "@/lib/audio-settings";
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
  buildOwnerOptions,
  splitOwners,
  formatOwners,
  buildOptionCovers,
  getRoundTiming,
  isPlayerRoundComplete,
  computeRoundPoints,
  db,
  getClientKey,
  getPlayerWinStreak,
  getPreviewSecondsForAttempt,
  getPreviewStartSeconds,
  getSavedName,
  isOwnerModeSchemaMissingError,
  saveName,
  shuffle,
  type GuessRow,
  type PlayerRow,
  type RoomRow,
  type RoundTrackRow,
  buildArtistOptions, buildChoiceOptions,
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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RoomPage,
});

const REVEAL_SECONDS = 6;
const ROOM_STATE_COLUMNS = "id,code,host_key,playlist_name,playlist_image,rounds,seconds,mode,status,current_round,round_started_at,round_revealed_at,team_battle,blend";
const PLAYER_STATE_COLUMNS = "id,avatar_path,room_id,name,client_key,score,is_host,playlist_name,team,created_at";
const PLAYER_PLAYLIST_COLUMNS = `${PLAYER_STATE_COLUMNS},playlist_tracks`;

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
  const [answerPending, setAnswerPending] = useState(false);
  const [online, setOnline] = useState(true);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const advancingRef = useRef(false);
  const submittingAnswerRef = useRef(false);

  useEffect(() => {
    setClientKey(getClientKey());
    setJoinName(getSavedName());
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const update = () => { if (audioRef.current) audioRef.current.volume = getMusicVolume(); };
    update();
    window.addEventListener(MUSIC_VOLUME_EVENT, update);
    return () => window.removeEventListener(MUSIC_VOLUME_EVENT, update);
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
    setNow(Date.now());
    if (room?.status !== "playing") return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [room?.status]);

  // Sync with server clock so every player reveals the answer at the same time
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        // Browsers hide the Date header (CORS), so ask the database for its clock.
        let best: { rtt: number; offset: number } | null = null;
        for (let i = 0; i < 3; i++) {
          const started = Date.now();
          const { data, error } = await (db as any).rpc("server_now");
          const ended = Date.now();
          if (error || !data) continue;
          const server = new Date(data as string).getTime();
          if (!Number.isFinite(server)) continue;
          const rtt = ended - started;
          const offset = server - (started + rtt / 2);
          if (!best || rtt < best.rtt) best = { rtt, offset };
        }
        if (best && !cancelled) setClockOffset(best.offset);
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

  const loadRoom = useCallback(async (includeTracks = false) => {
    try {
      const { data, error } = await db
        .from("rooms")
        .select(includeTracks ? "*" : ROOM_STATE_COLUMNS)
        .eq("code", code.toUpperCase())
        .maybeSingle();
      if (error) {
        throw error;
      }
      if (!data) {
        setNotFound(true);
        return null;
      }
      const next = data as unknown as RoomRow;
      setRoom((current) =>
        !includeTracks && current?.id === next.id ? { ...next, tracks: current.tracks } : next,
      );
      setNotFound(false);
      return next;
    } catch (err) {
      console.error("loadRoom failed", err);
      setError(getErrorMessage(err, "No se pudo cargar la sala."));
      setNotFound(false);
      return null;
    }
  }, [code]);

  const loadPlayers = useCallback(async (roomId: string, includePlaylists = false) => {
    try {
      const { data, error } = await db
        .from("players")
        .select(includePlaylists ? PLAYER_PLAYLIST_COLUMNS : PLAYER_STATE_COLUMNS)
        .eq("room_id", roomId)
        .order("created_at");
      if (error) throw error;
      const next = (data ?? []) as PlayerRow[];
      setPlayers((current) => {
        if (includePlaylists) return next;
        const previous = new Map(current.map((player) => [player.id, player]));
        // Keep already loaded playlists without downloading them after every score update.
        return next.map((player) => ({
          ...player,
          playlist_tracks: previous.get(player.id)?.playlist_tracks ?? [],
        }));
      });
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
      const found = await loadRoom(true);
      if (found) {
        await Promise.all([loadPlayers(found.id, true), loadGuesses(found.id)]);
      }
    })();
  }, [loadRoom, loadPlayers, loadGuesses]);

  const roomId = room?.id;
  const includePlaylistTracks = room?.status === "lobby";

  useEffect(() => {
    if (!roomId) return;

    let cancelled = false;
    let refreshing = false;
    let flushTimer = 0;
    const pending = { room: false, players: false, guesses: false };

    const flush = async () => {
      if (cancelled || refreshing || !navigator.onLine || document.hidden) return;
      refreshing = true;
      const requested = { ...pending };
      pending.room = false;
      pending.players = false;
      pending.guesses = false;
      try {
        await Promise.all([
          requested.room ? loadRoom() : Promise.resolve(null),
          requested.players ? loadPlayers(roomId, includePlaylistTracks) : Promise.resolve(),
          requested.guesses ? loadGuesses(roomId) : Promise.resolve(),
        ]);
      } finally {
        refreshing = false;
        if (pending.room || pending.players || pending.guesses) scheduleFlush();
      }
    };

    const scheduleFlush = () => {
      window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => void flush(), 80);
    };

    const request = (part: keyof typeof pending) => {
      pending[part] = true;
      scheduleFlush();
    };
    const refresh = () => {
      pending.room = true;
      pending.players = true;
      pending.guesses = true;
      scheduleFlush();
    };
    const onVisibilityChange = () => {
      if (!document.hidden) refresh();
    };

    // Realtime refreshes only the table that changed; a slow poll repairs missed events.
    const channel = db
      .channel(`room-state-${roomId}`)
      .on("postgres_changes" as never, { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, () => request("room"))
      .on("postgres_changes" as never, { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` }, () => request("players"))
      .on("postgres_changes" as never, { event: "*", schema: "public", table: "guesses", filter: `room_id=eq.${roomId}` }, () => request("guesses"))
      .subscribe();
    const id = window.setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", refresh);

    return () => {
      cancelled = true;
      window.clearTimeout(flushTimer);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", refresh);
      void db.removeChannel(channel);
    };
  }, [roomId, includePlaylistTracks, loadRoom, loadPlayers, loadGuesses]);

  // Current round track
  useEffect(() => {
    if (!room || room.status !== "playing" || room.current_round < 0) {
      setTrack(null);
      return;
    }
    let cancelled = false;
    let retry = 0;
    setTrack(null);
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
    ? (now + clockOffset - new Date(room.round_started_at).getTime()) / 1000
    : 0;
  const timing = getRoundTiming(room?.round_started_at ?? null, room?.round_revealed_at, seconds, now + clockOffset, REVEAL_SECONDS);
  const remaining = timing.remaining;
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
  const roundDone = isPlayerRoundComplete(room?.mode ?? "type", myRoundGuesses);
  // Every client uses the same persisted reveal timestamp, including reconnects.
  const revealing = room?.status === "playing" && timing.revealing;

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
    const isRevealing = revealing;
    if (isRevealing && !revealSoundRef.current) {
      revealSoundRef.current = true;
      sfx.reveal();
    } else if (!isRevealing) {
      revealSoundRef.current = false;
    }
  }, [revealing, room?.current_round]);

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
      : `track-${track.id}`;

    if (audio.dataset["key"] !== datasetKey) {
      audio.dataset["key"] = datasetKey;
      audio.src = track.preview_url;
      audio.loop = false;
      audio.volume = getMusicVolume();
      let timeoutId: number | undefined;
      let hasStarted = false;
      let timeoutStarted = false;
      const handlePlaying = () => {
        if (!shouldLimitPreview || timeoutStarted) return;
        timeoutStarted = true;
        timeoutId = window.setTimeout(() => {
          audio.pause();
          audio.currentTime = 0;
        }, triesPreviewSeconds * 1000);
      };
      audio.addEventListener("playing", handlePlaying);
      const startPlayback = () => {
        if (hasStarted) return;
        hasStarted = true;
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        const maxStart = shouldLimitPreview
          ? triesPreviewSeconds
          : seconds;
        const attemptIndex = shouldLimitPreview ? Math.min(myRoundGuesses.length, 3) : 0;
        const start = getPreviewStartSeconds(track.id, duration, maxStart, attemptIndex);
        const roundElapsed = room?.round_started_at
          ? Math.max(0, (Date.now() + clockOffset - new Date(room.round_started_at).getTime()) / 1000)
          : 0;
        const position = shouldLimitPreview
          ? start
          : start + roundElapsed;
        if (position >= duration) return;
        audio.currentTime = position;
        audio
          .play()
          .then(() => setAudioBlocked(false))
          .catch(() => setAudioBlocked(true));
      };
      audio.addEventListener("loadedmetadata", startPlayback, { once: true });
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) startPlayback();

      return () => {
        audio.removeEventListener("loadedmetadata", startPlayback);
        audio.removeEventListener("playing", handlePlaying);
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      };
    }
    return undefined;
  }, [track, room?.status, room?.mode, triesPreviewSeconds, triesAttempt, replayNonce]);

  useEffect(() => {
    if (revealing || room?.status !== "playing") audioRef.current?.pause();
  }, [revealing, room?.status]);

  async function unlockAudio() {
    try {
      const audio = audioRef.current;
      if (audio && track && room?.status === "playing" && Number.isFinite(audio.duration)) {
        const shouldLimitPreview = room.mode === "tries" && typeof triesPreviewSeconds === "number";
        const previewSeconds = shouldLimitPreview ? triesPreviewSeconds : seconds;
        const attemptIndex = shouldLimitPreview ? Math.min(myRoundGuesses.length, 3) : 0;
        const start = getPreviewStartSeconds(track.id, audio.duration, previewSeconds, attemptIndex);
        const elapsed = room.round_started_at
          ? Math.max(0, (Date.now() + clockOffset - new Date(room.round_started_at).getTime()) / 1000)
          : 0;
        const position = shouldLimitPreview ? start : start + elapsed;
        if (position < audio.duration) audio.currentTime = position;
      }
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
      await loadPlayers(me.room_id, true);
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
      await loadRoom(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pude leer esa playlist.");
    } finally {
      setBusy(false);
    }
  }

  async function changeMode(mode: string) {
    if (!room || !isHost || room.status !== "lobby") return;
    setError(null);
    const { error } = await db.from("rooms").update({ mode }).eq("id", room.id);
    if (error) setError(getErrorMessage(error, "No se pudo cambiar el modo."));
    await loadRoom();
  }

  async function toggleBlend(next: boolean) {
    if (!room || !isHost || room.status !== "lobby") return;
    setError(null);
    const update = room.mode === "blend" ? { blend: next, mode: "choice" } : { blend: next };
    const { error } = await db.from("rooms").update(update).eq("id", room.id);
    if (error) setError(getErrorMessage(error, "No se pudo cambiar Blend."));
    await loadRoom();
  }

  async function startGame() {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const blendOn = Boolean(room.blend) || room.mode === "blend";
      await db.from("rooms").update({ status: "loading" }).eq("id", room.id);
      const allTracks =
        room.mode === "owner" || blendOn
          ? shuffle(buildBlendTracks(players))
          : room.tracks ?? [];
      if ((room.mode === "owner" || blendOn) && players.some((player) => !player.playlist_tracks?.length)) {
        throw new Error("Todos los jugadores deben cargar una playlist antes de empezar.");
      }
      const pool = shuffle(allTracks);
      const candidates = pool
        .filter((track) => room.mode !== "chronology" || Boolean(track.releaseDate))
        .slice(0, Math.min(pool.length, room.rounds * 4));
      if (room.mode === "chronology" && candidates.length < 2) {
        throw new Error("El modo Cronología necesita canciones con fecha de lanzamiento.");
      }
      const { tracks: found } = await runFindTracks({
        data: { candidates, need: room.rounds + 6 },
      });
      // Download every clip before starting so no round stays silent.
      const checks = await preloadClips(found.map((t) => t.previewUrl), 4);
      const playable = found.filter((_, i) => checks[i]).slice(0, room.rounds);
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
            ? buildOwnerOptions(
                splitOwners((t as { sourcePlayerName?: string }).sourcePlayerName),
                players.map((p) => p.name),
              )
            : room.mode === "artist"
            ? buildArtistOptions(t.artist, allTracks)
            : buildChoiceOptions(t, allTracks);
        return {
          room_id: room.id,
          idx,
          title: t.title,
          artist: t.artist,
          preview_url: t.previewUrl,
          cover: t.cover,
          options,
          option_covers: buildOptionCovers(options, t, allTracks),
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
    if (!revealing || timing.revealRemaining > 0 || advancingRef.current) return;
    advancingRef.current = true;
    void (async () => {
      const next = room.current_round + 1;
      if (next >= room.rounds) {
        const { error } = await db.from("rooms").update({ status: "finished" }).eq("id", room.id).eq("current_round", room.current_round);
        if (error) setError(getErrorMessage(error, "No se pudo terminar la partida."));
      } else {
        const { error } = await db
          .from("rooms")
          .update({ current_round: next, round_started_at: new Date().toISOString() })
          .eq("id", room.id).eq("current_round", room.current_round);
        if (error) setError(getErrorMessage(error, "No se pudo avanzar de ronda."));
      }
      await loadRoom();
      advancingRef.current = false;
    })();
  }, [room, isHost, revealing, timing.revealRemaining, loadRoom]);



  async function submitAnswer(payload: { text: string } | { option: string }): Promise<boolean> {
    if (!room || !me || !track || track.idx !== room.current_round || revealing || roundDone || submittingAnswerRef.current || !online) return false;
    let titleOk = false;
    let artistOk = false;
    let answer = "";

    if (room.mode === "owner" && "option" in payload) {
      answer = payload.option;
      titleOk = splitOwners(track.source_player_name).includes(payload.option);
      artistOk = titleOk;
    } else if ("option" in payload) {
      answer = payload.option;
      titleOk = room.mode === "chronology"
        ? payload.option === track.options[0]
        : room.mode === "artist"
        ? payload.option === track.artist
        : payload.option === `${track.title} — ${track.artist}`;
      artistOk = titleOk;
    } else {
      answer = payload.text.trim();
      if (answer.length < 2) return false;
      titleOk = !titleFound && isClose(answer, track.title);
      artistOk = !artistFound && isClose(answer, track.artist);
    }

    submittingAnswerRef.current = true;
    setAnswerPending(true);
    setError(null);
    const usesMillisecondScoring = room.mode !== "tries" && room.mode !== "type";
    const basePoints = computeRoundPoints({
      titleCorrect: titleOk,
      artistCorrect: artistOk,
      remaining,
      totalSeconds: seconds,
      isOwnerGuess: room.mode === "owner",
      ...(usesMillisecondScoring ? { responseTimeMs: Math.max(0, elapsed * 1000) } : {}),
      ...(room.mode === "tries" ? { attemptIndex: myRoundGuesses.length } : {}),
    });
    const previousWinStreak = getPlayerWinStreak(guesses, me.id, room.current_round - 1);
    const points = basePoints > 0 && previousWinStreak > 0
      ? Math.round(basePoints * 1.2)
      : basePoints;

    try {
      const { error: guessError } = await db.from("guesses").insert({
        room_id: room.id,
        round_idx: room.current_round,
        player_id: me.id,
        answer,
        correct_title: titleOk,
        correct_artist: artistOk,
        points,
      });
      if (guessError) throw guessError;
      if (titleOk && artistOk) sfx.correct();
      else if (titleOk || artistOk) sfx.partial();
      else if ("text" in payload && nearMissHint(answer, track.title, track.artist, titleFound, artistFound)) sfx.near();
      else sfx.wrong();
      if (points > 0) {
        const { error: scoreError } = await db.from("players").update({ score: me.score + points }).eq("id", me.id);
        if (scoreError) setError("Respuesta guardada, pero no se pudieron actualizar los puntos.");
      }
      await Promise.all([loadGuesses(room.id), loadPlayers(room.id), loadRoom()]);
      return true;
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo enviar tu respuesta. Inténtalo de nuevo."));
      return false;
    } finally {
      submittingAnswerRef.current = false;
      setAnswerPending(false);
    }
  }


  async function playAgain() {
    if (!room || !isHost || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: guessesError } = await db.from("guesses").delete().eq("room_id", room.id);
      if (guessesError) throw guessesError;
      const { error: tracksError } = await db.from("round_tracks").delete().eq("room_id", room.id);
      if (tracksError) throw tracksError;
      const { error: scoresError } = await db.from("players").update({ score: 0 }).eq("room_id", room.id);
      if (scoresError) throw scoresError;
      const { error: roomError } = await db
        .from("rooms")
        .update({ status: "lobby", current_round: -1, round_started_at: null, round_revealed_at: null })
        .eq("id", room.id);
      if (roomError) throw roomError;
      await Promise.all([loadRoom(true), loadPlayers(room.id, true), loadGuesses(room.id)]);
    } catch (err) {
      setError(getErrorMessage(err, "No se pudo preparar otra partida. Inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  }

  const currentRound = room?.current_round ?? -1;
  const currentMode = room?.mode ?? "type";
  const ranked = useMemo(() => [...players].sort((a, b) => b.score - a.score), [players]);
  const playerStreaks = useMemo(
    () => new Map(ranked.map((player) => [player.id, getPlayerWinStreak(guesses, player.id, currentRound)])),
    [ranked, guesses, currentRound],
  );
  const completedPlayers = useMemo(
    () => players.filter((player) =>
      isPlayerRoundComplete(currentMode, guesses.filter((guess) => guess.player_id === player.id && guess.round_idx === currentRound)),
    ).length,
    [players, guesses, currentMode, currentRound],
  );

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
        {error && <><p role="alert" className="mt-4 text-sm text-destructive">{error}</p><Button className="mt-4" onClick={() => void loadRoom(true)}>Reintentar</Button></>}
      </Centered>
    );
  }

  if (!me) {
    return (
      <Centered>
        <form onSubmit={handleJoin} className="panel w-full max-w-sm space-y-6 p-7 text-left sm:p-8">
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Te han invitado</p>
            <h1 className="mt-2 font-display text-3xl">Sala {room.code}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{room.playlist_name}</p>
          </div>
          <label className="block space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Tu nombre</span>
            <input
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              placeholder="DJ Ana"
              autoComplete="nickname"
              maxLength={20}
              className="field-input"
            />
          </label>
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

  return (
    <PlayerPhotos me={me} clientKey={clientKey} players={players}>
      <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-6 sm:px-6 sm:pt-8">
        <audio ref={audioRef} playsInline className="hidden" />

        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
              {room.status === "lobby" ? "Sala abierta" : room.status === "finished" ? "Partida terminada" : "Partida en vivo"}
            </p>
            <h1 className="mt-1 truncate text-sm font-semibold text-muted-foreground">{room.playlist_name}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Users className="size-4" /> {players.length}
            </span>
            <RoomShare code={room.code} />
          </div>
        </header>

        {!online && (
          <p role="status" className="mt-5 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <WifiOff className="size-4 shrink-0" /> Sin conexión. Intentando reconectar…
          </p>
        )}
        {error && room.status !== "lobby" && (
          <p role="alert" className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        )}

        {audioBlocked && room.status === "playing" && (
          <button
            onClick={unlockAudio}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground"
          >
            <Volume2 className="size-4" /> Activar el sonido
          </button>
        )}

        <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_310px]">
          <section className="panel min-w-0 p-5 sm:p-7">
            {room.status === "lobby" && (
              <Lobby
                isHost={isHost}
                busy={busy}
                rounds={room.rounds}
                seconds={room.seconds}
                mode={room.mode === "blend" ? "choice" : room.mode}
                blend={Boolean(room.blend) || room.mode === "blend"}
                onToggleBlend={toggleBlend}
                players={players}
                me={me}
                total={room.tracks?.length ?? 0}
                playlistName={room.playlist_name}
                onStart={startGame}
                onChangePlaylist={changePlaylist}
                onUploadPlayerPlaylist={uploadPlayerPlaylist}
                onChangeMode={changeMode}
                error={error}
              />
            )}

            {room.status === "loading" && (
              <div className="flex min-h-96 flex-col items-center justify-center gap-4 text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Loader2 className="size-6 animate-spin" />
                </span>
                <div>
                  <p className="font-display text-xl">Preparando la partida</p>
                  <p className="mt-2 text-sm text-muted-foreground">Cargando canciones y comprobando que suenan.</p>
                </div>
              </div>
            )}

            {room.status === "playing" && (
              <RoundView
                room={room}
                track={track?.idx === room.current_round ? track : null}
                remaining={remaining}
                revealing={revealing}
                myGuesses={myRoundGuesses}
                titleFound={titleFound}
                artistFound={artistFound}
                roundPoints={roundPoints}
                roundDone={roundDone}
                answerPending={answerPending || !online}
                revealRemaining={timing.revealRemaining}
                completedPlayers={completedPlayers}
                totalPlayers={players.length}
                onAnswer={submitAnswer}
                onReplay={() => setReplayNonce((value) => value + 1)}
              />
            )}

            {room.status === "finished" && (
              <GameResults
                players={ranked}
                guesses={guesses}
                mode={room.mode}
                rounds={room.rounds}
                myId={me.id}
                teams={teamTotals}
                onPlayAgain={isHost ? playAgain : undefined}
                busy={busy}
              />
            )}
          </section>

          <aside className="space-y-5 lg:sticky lg:top-6">
            <section className="panel p-5">
              <ProfilePhotoUpload me={me} clientKey={clientKey} />
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {room.team_battle ? "Equipos" : "Marcador"}
                </h2>
                <span className="text-[10px] text-muted-foreground">Puntos</span>
              </div>
              <ul className="mt-3 divide-y divide-border">
                {room.team_battle
                  ? teamTotals.map((team) => (
                      <li key={team.team} className="flex items-center justify-between py-3 text-sm">
                        <span className="font-semibold">Equipo {team.team}</span>
                        <AnimatedScore value={team.total} className="font-display text-sm" />
                      </li>
                    ))
                  : ranked.map((p, index) => {
                      const answered = guesses.some(
                        (g) => g.player_id === p.id && g.round_idx === room.current_round,
                      );
                      return (
                        <li key={p.id} className={`flex items-center justify-between gap-2 py-3 text-sm ${p.id === me.id ? "text-foreground" : "text-muted-foreground"}`}>
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                            <PlayerPhoto playerId={p.id} name={p.name} />
                            <span className="min-w-0 truncate font-semibold">{p.name}</span>
                            {p.is_host && <Crown className="size-3.5 shrink-0 text-primary" />}
                            {room.status === "playing" && answered && <span className="size-1.5 shrink-0 rounded-full bg-success" aria-label="Ha respondido" />}
                            {(playerStreaks.get(p.id) ?? 0) >= 2 && <span className="shrink-0 text-[10px] font-bold text-primary">×1.2</span>}
                          </span>
                          <AnimatedScore value={p.score} className="shrink-0 font-display text-sm text-foreground" />
                        </li>
                      );
                    })}
              </ul>
              {room.team_battle && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  {players.map((player) => (
                    <div key={player.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <PlayerPhoto playerId={player.id} name={player.name} />
                      <span className="break-words">{player.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <RoomChat roomId={room.id} playerId={me.id} name={me.name} />
          </aside>
        </div>
      </main>
    </PlayerPhotos>
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
  onChangeMode,
  blend,
  onToggleBlend,
  error,
}: {
  blend: boolean;
  onToggleBlend: (next: boolean) => void;
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
  onChangeMode: (mode: string) => void;
  error: string | null;
}) {
  const runClientId = useServerFn(getSpotifyClientId);
  const [newPlaylist, setNewPlaylist] = useState("");
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const spotify = isSpotifyConnected();
  const usesPlayerLists = mode === "owner" || blend;
  const canUploadPlaylist = usesPlayerLists || isHost;

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
    if (usesPlayerLists) onUploadPlayerPlaylist(urls);
    else onChangePlaylist(urls);
    setNewPlaylist("");
    setSelected(new Set());
  }

  return (
    <div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Todo listo para jugar</p>
        <h2 className="mt-2 font-display text-3xl">Sala de espera</h2>
        <p className="mt-2 text-sm text-muted-foreground">Comparte el código y reúne a tu grupo.</p>
      </div>

      <dl className="mt-6 grid grid-cols-3 divide-x divide-border border-y border-border py-4 text-center">
        <Stat label="Canciones" value={String(rounds)} />
        <Stat label="Segundos" value={String(seconds)} />
        <Stat label="Modo" value={MODE_LABELS[mode] ?? "Escribir"} />
      </dl>

      {isHost && (
        <fieldset className="mt-6">
          <legend className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Modo de juego</legend>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(MODE_LABELS).filter(([value]) => value !== "blend").map(([value, text]) => (
              <button
                key={value}
                type="button"
                disabled={busy}
                aria-pressed={mode === value}
                onClick={() => mode !== value && onChangeMode(value)}
                className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-bold disabled:opacity-60 ${
                  mode === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:border-foreground/40"
                }`}
              >
                {text}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {isHost && mode !== "owner" && (
        <label className="mt-5 flex items-center justify-between gap-4 rounded-xl bg-secondary px-4 py-3">
          <span>
            <span className="block text-sm font-bold">Blend</span>
            <span className="mt-1 block text-xs text-muted-foreground">Mezcla las playlists de todos.</span>
          </span>
          <input
            type="checkbox"
            checked={blend}
            disabled={busy}
            onChange={(e) => onToggleBlend(e.target.checked)}
            className="size-4 shrink-0 accent-primary"
          />
        </label>
      )}
      {!isHost && blend && mode !== "owner" && (
        <p className="mt-4 rounded-xl bg-secondary p-3 text-xs font-semibold text-foreground">Blend activado: sube tu playlist para mezclarla.</p>
      )}

      <div className="mt-6 border-t border-border pt-5">
        {usesPlayerLists ? (
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {mode === "owner" ? "Playlists de los jugadores" : "Mezcla de playlists"}
            </p>
            {mode !== "owner" ? (
              <>
                <div className="divide-y divide-border rounded-xl border border-border px-3">
                  {players.filter((player) => player.playlist_tracks?.length).map((player) => (
                    <div key={player.id} className="flex items-center justify-between gap-3 py-2.5 text-sm text-muted-foreground">
                      <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                        <PlayerPhoto playerId={player.id} name={player.name} />
                        <span className="break-words">{player.name}</span>
                      </span>
                      <span className="shrink-0 text-xs">{player.playlist_tracks?.length ?? 0} canciones</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">Las canciones repetidas se detectan y cuentan para todos sus dueños.</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {players.filter((player) => player.playlist_tracks?.length).length}/{players.length} jugadores ya cargaron su playlist.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{playlistName}</strong>
            <span className="mt-1 block text-xs">{total} canciones cargadas · nuevas rondas en cada partida</span>
          </p>
        )}
      </div>

      {canUploadPlaylist && (
        <div className="mt-5 space-y-3">
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
              aria-label="Enlace de playlist"
              className="field-input min-w-0 flex-1"
            />
            <button
              type="submit"
              disabled={busy || (!newPlaylist.trim() && selected.size === 0)}
              className="shrink-0 rounded-xl border border-border px-4 text-sm font-bold hover:bg-secondary disabled:opacity-50"
            >
              {usesPlayerLists ? "Cargar" : "Cambiar"}
            </button>
          </form>
        </div>
      )}

      <div className="mt-7 border-t border-border pt-5">
        {isHost ? (
          <button
            onClick={onStart}
            disabled={busy || (usesPlayerLists && players.some((player) => !player.playlist_tracks?.length))}
            className="glow inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-8 py-3.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}
            {busy ? "Preparando…" : "Empezar partida"}
          </button>
        ) : (
          <p role="status" className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
            <span className="size-2 rounded-full bg-primary" /> Esperando al anfitrión…
          </p>
        )}
        {error && <p role="alert" className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      </div>
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
  answerPending,
  revealRemaining,
  completedPlayers,
  totalPlayers,
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
  onAnswer: (payload: { text: string } | { option: string }) => Promise<boolean>;
  onReplay: () => void;
  answerPending: boolean;
  revealRemaining: number;
  completedPlayers: number;
  totalPlayers: number;
}) {
  const [text, setText] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function sendText(event: React.FormEvent) {
    event.preventDefault();
    if (answerPending || text.trim().length < 2) return;
    const sent = text;
    if (await onAnswer({ text: sent })) {
      setText((current) => current === sent ? "" : current);
      inputRef.current?.focus();
    }
  }

  useEffect(() => {
    setText("");
    setPulse(null);
    lastGuessIdRef.current = null;
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
    lastGuessIdRef.current = last.id;
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

  // Multiple-choice feedback: color the picked option and reveal the right one.
  const ownerAnswers = room.mode === "owner" ? splitOwners(track.source_player_name) : [];
  const correctOption =
    room.mode === "owner"
      ? formatOwners(track.source_player_name)
      : room.mode === "chronology"
      ? track.options[0] ?? ""
      : room.mode === "artist"
      ? track.artist
      : `${track.title} — ${track.artist}`;
  const isRightOption = (option: string) =>
    room.mode === "owner" ? ownerAnswers.includes(option) : option === correctOption;
  const myOption = myGuesses[0]?.answer ?? null;
  const myOptionCorrect = Boolean(myGuesses[0]?.correct_title);

  function optionClass(option: string): string {
    const base = "rounded-xl border px-4 py-4 text-left text-sm font-medium transition";
    if (myOption === null) {
      return `${base} border-border bg-background/40 hover:border-primary hover:bg-primary/10`;
    }
    if (option === myOption && myOptionCorrect) {
      return `${base} border-success bg-success/20 text-success flash-ok`;
    }
    if (option === myOption) return `${base} border-destructive bg-destructive/20 text-destructive shake`;
    if (isRightOption(option)) return `${base} border-success bg-success/15 text-success`;
    return `${base} border-border bg-background/20 opacity-50`;
  }

  function renderOptions() {
    if (!track) return null;
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {track.options.map((option) => (
          <Button variant="outline"
            key={option}
            aria-label={option}
            disabled={myOption !== null || answerPending || revealing}
            onClick={() => void onAnswer({ option })}
            className={`${optionClass(option)} h-auto min-h-20 justify-start whitespace-normal break-words disabled:opacity-100`}
          >
            {(room.mode === "choice" || room.mode === "blend") && (
              <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary text-muted-foreground">
                <Music2 className="size-6" aria-hidden="true" />
                {track.option_covers?.[option] && <img src={track.option_covers[option] ?? ""} alt={`Portada de ${option}`} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" onError={(event) => { event.currentTarget.hidden = true; }} />}
              </span>
            )}
            <span className="min-w-0 flex-1">{option}</span>
            {myOption !== null && isRightOption(option) && <Check className="shrink-0" />}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between text-xs uppercase tracking-widest text-muted-foreground">
        <span>
          Ronda {room.current_round + 1} / {room.rounds}
        </span>
        <span className={`font-display text-2xl font-bold tabular-nums ${remaining <= 5 && !revealing ? "text-destructive" : "text-primary"}`}>
          {Math.ceil(remaining)}s
        </span>
      </div>

      {!revealing && <p role="status" className="mt-3 text-right text-xs text-muted-foreground">{answerPending ? "Enviando…" : `${completedPlayers}/${totalPlayers} jugadores completaron la ronda`}</p>}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
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
          <div key={`reveal-${room.current_round}`} className="text-center">
            {track.cover && (
              <div className="relative mx-auto size-40">
                <span className="reveal-burst absolute inset-0 rounded-2xl" />
                <img
                  src={track.cover}
                  alt={`Portada de ${track.title}`}
                  className="reveal-cover relative size-40 rounded-2xl object-cover"
                />
              </div>
            )}
            <p className="reveal-line mt-4 font-display text-2xl font-bold" style={{ animationDelay: "160ms" }}>
              {track.title}
            </p>
            <p className="reveal-line text-sm text-muted-foreground" style={{ animationDelay: "280ms" }}>
              {track.artist}
            </p>
            {(room.mode === "owner" || room.blend || room.mode === "blend") && track.source_player_name && (
              <p className="reveal-line mt-3 text-sm font-bold text-primary" style={{ animationDelay: "380ms" }}>
                {splitOwners(track.source_player_name).length > 1
                  ? `Estaba en varias playlists: ${formatOwners(track.source_player_name)}`
                  : room.mode === "owner"
                    ? `La playlist era de ${track.source_player_name}`
                    : `Aportada por ${track.source_player_name}`}
              </p>
            )}
            <p
              className={`reveal-line mt-4 text-sm font-bold ${
                roundPoints > 0 ? "text-primary score-bump" : "text-muted-foreground"
              }`}
              style={{ animationDelay: "460ms" }}
            >
              {roundPoints > 0 ? `+${roundPoints} puntos` : "Sin puntos esta ronda"}
            </p>
            <p role="status" className="mt-5 text-xs tabular-nums text-muted-foreground">{room.current_round + 1 >= room.rounds ? "Resultados finales" : "Siguiente ronda"} en {Math.ceil(revealRemaining)}s</p>
            <a href={`https://open.spotify.com/search/${encodeURIComponent(`${track.title} ${track.artist}`)}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-primary underline underline-offset-4">Buscar en Spotify ↗</a>
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
              {renderOptions()}
              {myOption !== null && (
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  {myOptionCorrect ? "¡Correcto!" : `La respuesta era: ${correctOption}`} Espera al resto…
                </p>
              )}
            </div>
          ) : room.mode === "choice" || room.mode === "chronology" || room.mode === "blend" || room.mode === "artist" ? (
            <div>
              {room.mode === "chronology" && (
                <p className="mb-4 text-center text-sm font-semibold text-muted-foreground">
                  ¿Esta canción salió antes o después de la referencia?
                </p>
              )}
              {renderOptions()}
              {myOption !== null && (
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  {myOptionCorrect ? "¡Correcto!" : `La respuesta era: ${correctOption}`} Espera al resto…
                </p>
              )}
            </div>
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
                  onSubmit={sendText}
                  className="flex gap-2"
                >
                  <input
                    value={text}
                    ref={inputRef}
                    aria-label="Tu respuesta"
                    maxLength={200}
                    onChange={(e) => setText(e.target.value)}
                    autoFocus
                    placeholder="Escribe la canción o el artista…"
                    className="flex-1 rounded-xl border border-input bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary"
                  />
                  <Button size="icon" className="size-11 shrink-0" aria-label="Enviar respuesta" title="Enviar respuesta"
                    type="submit"
                    disabled={answerPending || text.trim().length < 2}
                  >
                    {answerPending ? <Loader2 className="animate-spin" /> : <Send />}
                  </Button>
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
                  onSubmit={sendText}
                  className="mt-4 flex gap-2"
                >
                  <input
                    value={text}
                    ref={inputRef}
                    aria-label="Tu respuesta"
                    maxLength={200}
                    onChange={(e) => setText(e.target.value)}
                    autoFocus
                    placeholder={
                      titleFound ? "¿Quién la canta?" : artistFound ? "¿Cómo se llama?" : "Escribe canción o artista…"
                    }
                    className="flex-1 rounded-xl border border-input bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary"
                  />
                  <Button size="icon" className="size-11 shrink-0" aria-label="Enviar respuesta" title="Enviar respuesta"
                    type="submit"
                    disabled={answerPending || text.trim().length < 2}
                  >
                    {answerPending ? <Loader2 className="animate-spin" /> : <Send />}
                  </Button>
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
    <div className="min-w-0 px-2">
      <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-display text-sm sm:text-base">{value}</dd>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-[calc(100vh-4.5rem)] flex-col items-center justify-center px-5 text-center">
      {children}
    </main>
  );
}

const MODE_LABELS: Record<string, string> = {
  type: "Escribir",
  choice: "Opción múltiple",
  tries: "4 intentos",
  chronology: "Cronología",
  owner: "¿De quién es?",
  artist: "Adivina el artista",
  blend: "Blend",
};

/** Preloads a bounded number of clips at once so large playlists do not saturate the connection. */
async function preloadClips(urls: string[], concurrency: number): Promise<boolean[]> {
  const results = new Array<boolean>(urls.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < urls.length) {
      const index = nextIndex++;
      const url = urls[index];
      if (!url) return;
      results[index] = await preloadClip(url);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return results;
}

/** Fully downloads one clip; resolves false if it can't be played. */
function preloadClip(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      audio.oncanplaythrough = null;
      audio.onerror = null;
      resolve(ok);
    };
    const timer = window.setTimeout(() => done(false), 12000);
    audio.preload = "auto";
    audio.oncanplaythrough = () => done(true);
    audio.onerror = () => done(false);
    audio.src = url;
    audio.load();
  });
}
