ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS round_revealed_at timestamptz;
ALTER TABLE public.round_tracks ADD COLUMN IF NOT EXISTS option_covers jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.reset_round_reveal()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.current_round IS DISTINCT FROM OLD.current_round OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.round_revealed_at := NULL;
    IF NEW.status = 'playing' THEN NEW.round_started_at := clock_timestamp(); END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reset_round_reveal_before_update BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.reset_round_reveal();

CREATE OR REPLACE FUNCTION public.lock_answer_round()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM id FROM public.rooms WHERE id = NEW.room_id FOR UPDATE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lock_answer_round_before_insert BEFORE INSERT ON public.guesses FOR EACH ROW EXECUTE FUNCTION public.lock_answer_round();

CREATE OR REPLACE FUNCTION public.reveal_completed_round()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE active_room public.rooms%ROWTYPE;
BEGIN
  SELECT * INTO active_room FROM public.rooms WHERE id = NEW.room_id;
  IF active_room.status <> 'playing' OR NEW.round_idx <> active_room.current_round OR active_room.round_revealed_at IS NOT NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE room_id = NEW.room_id) AND NOT EXISTS (
    SELECT 1 FROM public.players p WHERE p.room_id = NEW.room_id AND NOT (
      SELECT CASE
        WHEN active_room.mode IN ('choice', 'blend', 'owner', 'chronology') THEN count(*) > 0
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
$$;
CREATE TRIGGER reveal_completed_round_after_insert AFTER INSERT ON public.guesses FOR EACH ROW EXECUTE FUNCTION public.reveal_completed_round();
REVOKE ALL ON FUNCTION public.reset_round_reveal() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lock_answer_round() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reveal_completed_round() FROM PUBLIC;