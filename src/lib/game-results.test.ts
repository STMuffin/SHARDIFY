import test from "node:test";
import assert from "node:assert/strict";
import { getPlayerGameResults } from "./game-results";

const guess = (round_idx: number, correct_title: boolean, correct_artist = correct_title, player_id = "ana") => ({ player_id, round_idx, correct_title, correct_artist });

test("text results combine title and artist without counting multiple chat attempts as multiple rounds", () => {
  const results = getPlayerGameResults([guess(0, false), guess(0, true, false), guess(0, false, true), guess(1, true, false)], "ana", "type", 2);
  assert.equal(results.correct, 1);
  assert.equal(results.partial, 1);
  assert.equal(results.wrong, 0);
});

for (const mode of ["choice", "blend", "owner", "chronology", "tries"]) {
  test(`${mode} results show correct, wrong and unanswered rounds separately`, () => {
    const result = getPlayerGameResults([guess(0, true), guess(1, false)], "ana", mode, 3);
    assert.deepEqual(result.outcomes, ["correct", "wrong", "unanswered"]);
    assert.equal(result.correct, 1);
    assert.equal(result.wrong, 1);
    assert.equal(result.unanswered, 1);
  });
}

test("four-attempt mode counts an eventual artist hit as one success despite previous errors", () => {
  const result = getPlayerGameResults([guess(0, false), guess(0, false, true)], "ana", "tries", 1);
  assert.equal(result.correct, 1);
  assert.equal(result.wrong, 0);
});

test("best streak counts consecutive correct rounds and resets for errors and skipped rounds", () => {
  const result = getPlayerGameResults([guess(4, true), guess(0, true), guess(1, true), guess(2, false), guess(3, true), guess(6, true)], "ana", "choice", 7);
  assert.equal(result.bestStreak, 2);
  assert.equal(result.streak, 1);
  assert.equal(result.correct, 5);
});

test("results belong to each player and exclude guesses outside the match", () => {
  const result = getPlayerGameResults([guess(0, true, true, "luis"), guess(1, false), guess(4, true), guess(-1, true)], "ana", "choice", 2);
  assert.equal(result.correct, 0);
  assert.equal(result.wrong, 1);
  assert.equal(result.unanswered, 1);
  assert.equal(result.bestStreak, 0);
});