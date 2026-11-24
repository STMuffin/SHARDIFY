import test from "node:test";
import assert from "node:assert/strict";

import { createAnswerVerifier, isClose } from "@/lib/match";

test("answer verification keeps accent, case and small typo tolerance", () => {
  const verify = createAnswerVerifier("Bésame Mucho", "Queen");
  assert.deepEqual(verify("besame mucho", false, false), { titleCorrect: true, artistCorrect: false });
  assert.deepEqual(verify("Bésame Much", false, false), { titleCorrect: true, artistCorrect: false });
  assert.deepEqual(verify("Queeen", false, false), { titleCorrect: false, artistCorrect: true });
});

test("answer verification recognizes either missing part without awarding a found part twice", () => {
  const verify = createAnswerVerifier("Imagine", "John Lennon");
  assert.deepEqual(verify("Imagine", true, false), { titleCorrect: false, artistCorrect: false });
  assert.deepEqual(verify("John Lennonn", true, false), { titleCorrect: false, artistCorrect: true });
});

test("answer verification rejects unrelated text", () => {
  const verify = createAnswerVerifier("Imagine", "John Lennon");
  assert.deepEqual(verify("completamente distinto", false, false), { titleCorrect: false, artistCorrect: false });
});

test("standalone matching accepts any artist in a collaboration", () => {
  assert.equal(isClose("Rosalía", "ROSALÍA and Rauw Alejandro"), true);
  assert.equal(isClose("Rauw Alejandr", "ROSALÍA and Rauw Alejandro"), true);
});
