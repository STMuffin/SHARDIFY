import assert from "node:assert/strict";
import test from "node:test";

import { fetchPlaylist } from "./music.server.ts";

test("fetchPlaylist follows every Spotify playlist page", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    new Response(JSON.stringify({ name: "Completa", tracks: { total: 3 } }), { status: 200 }),
    new Response(
      JSON.stringify({
        total: 3,
        next: "https://api.spotify.com/v1/playlists/test/items?offset=2",
        items: [
          { track: { name: "Una", artists: [{ name: "A" }] } },
          { track: { name: "Dos", artists: [{ name: "B" }] } },
        ],
      }),
      { status: 200 },
    ),
    new Response(
      JSON.stringify({
        total: 3,
        next: null,
        items: [{ track: { name: "Tres", artists: [{ name: "C" }] } }],
      }),
      { status: 200 },
    ),
  ];
  const requestedUrls: string[] = [];
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  };

  try {
    const result = await fetchPlaylist("https://open.spotify.com/playlist/test");
    assert.deepEqual(result.tracks.map((track) => track.title), ["Una", "Dos", "Tres"]);
    assert.equal(requestedUrls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});