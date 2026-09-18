CREATE OR REPLACE FUNCTION public.get_current_round_track(
  p_room_id uuid,
  p_round_idx integer
)
RETURNS SETOF public.round_tracks
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT round_track.*
  FROM public.round_tracks AS round_track
  INNER JOIN public.rooms AS room ON room.id = round_track.room_id
  WHERE round_track.room_id = p_room_id
    AND round_track.idx = p_round_idx
    AND room.status = 'playing'
    AND room.current_round = round_track.idx;
$$;

REVOKE ALL ON FUNCTION public.get_current_round_track(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_round_track(uuid, integer) TO anon, authenticated, service_role;