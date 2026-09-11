ALTER TABLE public.players
  ADD COLUMN playlist_name text NOT NULL DEFAULT '',
  ADD COLUMN playlist_tracks jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.round_tracks
  ADD COLUMN source_player_name text;
