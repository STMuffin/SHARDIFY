import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/spotdiag")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("id") ?? "";
        const cid = process.env["SPOTIFY_CLIENT_ID"] ?? "";
        const secret = process.env["SPOTIFY_CLIENT_SECRET"] ?? "";
        const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            authorization: `Basic ${btoa(`${cid}:${secret}`)}`,
          },
          body: "grant_type=client_credentials",
        });
        const tokenJson = (await tokenRes.json()) as { access_token?: string };
        const token = tokenJson.access_token;
        const out: Record<string, unknown> = {
          idLen: cid.length,
          secretLen: secret.length,
          tokenStatus: tokenRes.status,
          hasToken: Boolean(token),
        };
        if (token) {
          for (const [label, url] of [
            ["playlist", `https://api.spotify.com/v1/playlists/${id}?fields=name,owner(display_name,id),tracks(total)`],
            ["tracksPlain", `https://api.spotify.com/v1/playlists/${id}/tracks`],
            ["tracksOffset", `https://api.spotify.com/v1/playlists/${id}/tracks?offset=100&limit=100`],
            ["plFields", `https://api.spotify.com/v1/playlists/${id}?fields=tracks(total,next,items(track(name)))`],
          ] as const) {
            const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
            out[label] = `${r.status} ${(await r.text()).slice(0, 300)}`;
          }
        }
        return new Response(JSON.stringify(out, null, 2), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
