DROP POLICY IF EXISTS "players deletable" ON public.players;
DROP POLICY IF EXISTS "players insertable" ON public.players;
DROP POLICY IF EXISTS "players updatable" ON public.players;
CREATE POLICY "players join existing room" ON public.players FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id AND (is_host = false OR r.host_key = client_key)) AND char_length(name) BETWEEN 1 AND 40 AND score = 0);
CREATE POLICY "players update within room" ON public.players FOR UPDATE TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id) AND score >= 0);

CREATE OR REPLACE FUNCTION public.guard_player_update() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.room_id <> OLD.room_id OR NEW.client_key <> OLD.client_key OR NEW.is_host <> OLD.is_host OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Immutable player fields cannot change';
  END IF;
  IF NEW.score < OLD.score AND NEW.score <> 0 THEN
    RAISE EXCEPTION 'Score cannot decrease';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_player_update ON public.players;
CREATE TRIGGER guard_player_update BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.guard_player_update();

DROP POLICY IF EXISTS "round tracks deletable" ON public.round_tracks;
DROP POLICY IF EXISTS "round tracks insertable" ON public.round_tracks;
CREATE POLICY "round tracks insert while loading" ON public.round_tracks FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id AND r.status = 'loading'));
CREATE POLICY "round tracks delete after game" ON public.round_tracks FOR DELETE TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id AND r.status IN ('finished','lobby','loading')));

DROP POLICY IF EXISTS "guesses deletable" ON public.guesses;
DROP POLICY IF EXISTS "guesses insertable" ON public.guesses;
CREATE POLICY "guesses insert current round" ON public.guesses FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.rooms r JOIN public.players p ON p.room_id = r.id WHERE r.id = room_id AND p.id = player_id AND r.status = 'playing' AND r.current_round = round_idx) AND char_length(answer) <= 300 AND points BETWEEN 0 AND 2000);
CREATE POLICY "guesses delete after game" ON public.guesses FOR DELETE TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id AND r.status = 'finished'));

DROP POLICY IF EXISTS "chat insertable" ON public.chat_messages;
CREATE POLICY "chat insert by room member" ON public.chat_messages FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.players p WHERE p.id = player_id AND p.room_id = chat_messages.room_id AND p.name = chat_messages.name) AND char_length(body) BETWEEN 1 AND 300);

DROP POLICY IF EXISTS "rooms updatable" ON public.rooms;
CREATE POLICY "rooms update valid state" ON public.rooms FOR UPDATE TO anon, authenticated
  USING (status IN ('lobby','loading','playing','finished'))
  WITH CHECK (status IN ('lobby','loading','playing','finished') AND rounds BETWEEN 1 AND 200 AND seconds BETWEEN 3 AND 600);

CREATE OR REPLACE FUNCTION public.guard_room_update() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.code <> OLD.code OR NEW.host_key <> OLD.host_key OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Immutable room fields cannot change';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_room_update ON public.rooms;
CREATE TRIGGER guard_room_update BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.guard_room_update();