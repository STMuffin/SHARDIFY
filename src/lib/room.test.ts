import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBlendTracks, getPreviewStartSeconds } from './room.ts';

test('buildBlendTracks merges unique tracks from all players', () => {
  const tracks = buildBlendTracks([
    {
      name: 'Ana',
      playlist_tracks: [
        { title: 'Song 1', artist: 'Artist A', cover: null },
        { title: 'Song 2', artist: 'Artist B', cover: null },
      ],
    },
    {
      name: 'Luis',
      playlist_tracks: [
        { title: 'Song 1', artist: 'Artist A', cover: null },
        { title: 'Song 3', artist: 'Artist C', cover: null },
      ],
    },
  ] as any);

  assert.equal(tracks.length, 3);
  assert.ok(tracks.some((track) => track.title === 'Song 1' && track.artist === 'Artist A'));
  assert.ok(tracks.some((track) => track.title === 'Song 2' && track.artist === 'Artist B'));
  assert.ok(tracks.some((track) => track.title === 'Song 3' && track.artist === 'Artist C'));
});

test('getPreviewStartSeconds is deterministic for the same track and attempt', () => {
  const first = getPreviewStartSeconds('track-1', 30, 5, 1);
  const second = getPreviewStartSeconds('track-1', 30, 5, 1);

  assert.equal(first, second);
  assert.ok(first >= 0 && first <= 25);
  assert.notEqual(first, getPreviewStartSeconds('track-2', 30, 5, 1));
});
