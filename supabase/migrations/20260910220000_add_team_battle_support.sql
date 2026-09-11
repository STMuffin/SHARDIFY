ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS team_battle boolean NOT NULL DEFAULT false;

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS team text;
