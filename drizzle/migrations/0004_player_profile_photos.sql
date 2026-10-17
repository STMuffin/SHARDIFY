ALTER TABLE public.players ADD COLUMN avatar_path text;
COMMENT ON COLUMN public.players.avatar_path IS 'Private player-photos object path; signed URLs are resolved for room display.';