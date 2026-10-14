import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBlendTracks,
  computeRoundPoints,
  getPlayerWinStreak,
  getPreviewStartSeconds,
  buildOptionCovers,
  getRoundTiming,
  isPlayerRoundComplete,
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

for (const mode of ['choice', 'blend', 'owner', 'chronology']) {
  test(`${mode} completes after any answer, including a wrong answer`, () => {
    assert.equal(isPlayerRoundComplete(mode, []), false);
    assert.equal(isPlayerRoundComplete(mode, [{ correct_title: false, correct_artist: false }]), true);
  });
}

test('type completes only when both title and artist have been found across messages', () => {
  const title = { correct_title: true, correct_artist: false };
  assert.equal(isPlayerRoundComplete('type', [title]), false);
  assert.equal(isPlayerRoundComplete('type', [title, { correct_title: false, correct_artist: true }]), true);
});

test('tries completes on a hit or after four failed attempts', () => {
  const miss = { correct_title: false, correct_artist: false };
  assert.equal(isPlayerRoundComplete('tries', [miss, miss, miss]), false);
  assert.equal(isPlayerRoundComplete('tries', [miss, miss, miss, miss]), true);
  assert.equal(isPlayerRoundComplete('tries', [{ correct_title: false, correct_artist: true }]), true);
});

test('all clients reveal and advance from the shared early reveal time, not the original deadline', () => {
  const start = '2026-10-14T00:00:00.000Z';
  const reveal = '2026-10-14T00:00:05.000Z';
  assert.equal(getRoundTiming(start, reveal, 30, Date.parse(start) + 4000, 6).revealing, false);
  const timing = getRoundTiming(start, reveal, 30, Date.parse(start) + 6000, 6);
  assert.equal(timing.revealing, true);
  assert.equal(timing.remaining, 0);
  assert.equal(timing.revealRemaining, 5);
  assert.equal(getRoundTiming(start, reveal, 30, Date.parse(start) + 11000, 6).revealRemaining, 0);
  assert.equal(getRoundTiming(start, null, 30, Date.parse(start) + 30000, 6).revealing, true);
});

for (const mode of ['choice', 'blend']) {
  test(`${mode} covers correspond to their own answer and preserve the correct artwork`, () => {
    const correct = { title: 'One', artist: 'A', cover: '/correct.jpg' };
    assert.deepEqual(buildOptionCovers(['One — A', 'Two — B', 'Three — C'], correct, [
      { title: 'One', artist: 'A', cover: '/old.jpg' },
      { title: 'Two', artist: 'B', cover: '/second.jpg' },
    ]), { 'One — A': '/correct.jpg', 'Two — B': '/second.jpg', 'Three — C': null });
  });
}
