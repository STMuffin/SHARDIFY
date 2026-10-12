import test from "node:test";
import assert from "node:assert/strict";
import { clampVolume } from "./audio-settings";

test("music volume stays within the playable range", () => {
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(2), 1);
  assert.equal(clampVolume(0.35), 0.35);
  assert.equal(clampVolume(Number.NaN), 0.9);
});