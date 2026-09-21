import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBlendTracks,
  computeRoundPoints,
  getPlayerWinStreak,
  getPreviewStartSeconds,
} from './room.ts';

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

test('computeRoundPoints decreases continuously by response milliseconds', () => {
  const instant = computeRoundPoints({
    titleCorrect: true,
    artistCorrect: true,
    remaining: 30,
    totalSeconds: 30,
    responseTimeMs: 0,
  });
  const late = computeRoundPoints({
    titleCorrect: true,
    artistCorrect: true,
    remaining: 0,
    totalSeconds: 30,
    responseTimeMs: 30_000,
  });

  assert.equal(instant, 150);
  assert.equal(late, 15);
  assert.ok(
    computeRoundPoints({
      titleCorrect: true,
      artistCorrect: false,
      remaining: 0,
      totalSeconds: 30,
      responseTimeMs: 30_000,
    }) >= 15,
  );
});

test('getPlayerWinStreak counts only consecutive positive rounds', () => {
  const guesses = [
    { player_id: 'p1', round_idx: 0, points: 100 },
    { player_id: 'p1', round_idx: 1, points: 50 },
    { player_id: 'p1', round_idx: 2, points: 0 },
    { player_id: 'p1', round_idx: 3, points: 120 },
  ];

  assert.equal(getPlayerWinStreak(guesses, 'p1', 3), 1);
  assert.equal(getPlayerWinStreak(guesses, 'p1', 2), 0);
});
