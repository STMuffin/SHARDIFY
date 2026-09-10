CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  host_key text NOT NULL,
  playlist_name text NOT NULL DEFAULT '',
  playlist_image text,
  tracks jsonb NOT NULL DEFAULT '[]'::jsonb,
  rounds integer NOT NULL DEFAULT 10,
  seconds integer NOT NULL DEFAULT 30,
  mode text NOT NULL DEFAULT 'type',
  status text NOT NULL DEFAULT 'lobby',
  current_round integer NOT NULL DEFAULT -1,
  round_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  name text NOT NULL,
  client_key text NOT NULL,
  score integer NOT NULL DEFAULT 0,
  is_host boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, client_key)
);

CREATE TABLE public.round_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  title text NOT NULL,
  artist text NOT NULL,
  preview_url text NOT NULL,
  cover text,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (room_id, idx)
);

CREATE TABLE public.guesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round_idx integer NOT NULL,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  answer text NOT NULL DEFAULT '',
  correct_title boolean NOT NULL DEFAULT false,
  correct_artist boolean NOT NULL DEFAULT false,
  points integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, round_idx, player_id)
);

CREATE INDEX idx_players_room ON public.players(room_id);
CREATE INDEX idx_round_tracks_room ON public.round_tracks(room_id);
CREATE INDEX idx_guesses_room ON public.guesses(room_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.players TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.round_tracks TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guesses TO anon, authenticated;
GRANT ALL ON public.rooms TO service_role;
GRANT ALL ON public.players TO service_role;
GRANT ALL ON public.round_tracks TO service_role;
GRANT ALL ON public.guesses TO service_role;

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rooms readable" ON public.rooms FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rooms insertable" ON public.rooms FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rooms updatable" ON public.rooms FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "players readable" ON public.players FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "players insertable" ON public.players FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "players updatable" ON public.players FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "players deletable" ON public.players FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "round tracks readable when reached" ON public.round_tracks FOR SELECT TO anon, authenticated
USING (EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = round_tracks.room_id AND round_tracks.idx <= r.current_round));
CREATE POLICY "round tracks insertable" ON public.round_tracks FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "guesses readable" ON public.guesses FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "guesses insertable" ON public.guesses FOR INSERT TO anon, authenticated WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.guesses;
ALTER PUBLICATION supabase_realtime ADD TABLE public.round_tracks;