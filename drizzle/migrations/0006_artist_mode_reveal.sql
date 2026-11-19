CREATE OR REPLACE FUNCTION public.reveal_completed_round()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE active_room public.rooms%ROWTYPE;
BEGIN
  SELECT * INTO active_room FROM public.rooms WHERE id = NEW.room_id;
  IF active_room.status <> 'playing' OR NEW.round_idx <> active_room.current_round OR active_room.round_revealed_at IS NOT NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE room_id = NEW.room_id) AND NOT EXISTS (
    SELECT 1 FROM public.players p WHERE p.room_id = NEW.room_id AND NOT (
      SELECT CASE
        WHEN active_room.mode IN ('choice', 'blend', 'owner', 'chronology', 'artist') THEN count(*) > 0
        WHEN active_room.mode = 'tries' THEN count(*) >= 4 OR coalesce(bool_or(g.correct_title OR g.correct_artist), false)
        ELSE coalesce(bool_or(g.correct_title), false) AND coalesce(bool_or(g.correct_artist), false)
      END
      FROM public.guesses g WHERE g.room_id = NEW.room_id AND g.player_id = p.id AND g.round_idx = active_room.current_round
    )
  ) THEN
    UPDATE public.rooms SET round_revealed_at = LEAST(clock_timestamp(), round_started_at + seconds * interval '1 second') WHERE id = NEW.room_id;
  END IF;
  RETURN NEW;
END;
$function$;