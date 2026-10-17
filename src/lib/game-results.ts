import type { GuessRow } from "./room";

type ResultGuess = Pick<GuessRow, "player_id" | "round_idx" | "correct_title" | "correct_artist">;
export type RoundResult = "correct" | "partial" | "wrong" | "unanswered";

/** Count round outcomes, not chat messages; partial text answers stay distinct. */
export function getPlayerGameResults(guesses: ResultGuess[], playerId: string, mode: string, rounds: number) {
  const byRound = new Map<number, ResultGuess[]>();
  for (const guess of guesses) {
    if (guess.player_id !== playerId || guess.round_idx < 0 || guess.round_idx >= rounds) continue;
    const entries = byRound.get(guess.round_idx) ?? [];
    entries.push(guess);
    byRound.set(guess.round_idx, entries);
  }
  let correct = 0;
  let partial = 0;
  let wrong = 0;
  let unanswered = 0;
  let streak = 0;
  let bestStreak = 0;
  const outcomes: RoundResult[] = [];
  for (let round = 0; round < rounds; round++) {
    const entries = byRound.get(round) ?? [];
    const title = entries.some((guess) => guess.correct_title);
    const artist = entries.some((guess) => guess.correct_artist);
    const hit = mode === "type" ? title && artist : title || artist;
    if (hit) {
      correct++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      outcomes.push("correct");
    } else {
      streak = 0;
      if (title || artist) {
        partial++;
        outcomes.push("partial");
      } else if (entries.length) {
        wrong++;
        outcomes.push("wrong");
      } else {
        unanswered++;
        outcomes.push("unanswered");
      }
    }
  }
  return { correct, partial, wrong, unanswered, streak, bestStreak, outcomes };
}