import { createServerFn } from "@tanstack/react-start";

/** The Spotify client id is public by design (it travels in the auth URL). */
export const getSpotifyClientId = createServerFn({ method: "GET" }).handler(async () => {
  return { clientId: process.env["SPOTIFY_CLIENT_ID"] ?? null };
});
