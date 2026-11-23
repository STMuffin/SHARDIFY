import test from "node:test";
import assert from "node:assert/strict";
import { normalizeThemePreference, resolveTheme } from "./theme";

test("theme preference falls back to the device theme", () => {
  assert.equal(normalizeThemePreference(null), "system");
  assert.equal(normalizeThemePreference("unexpected"), "system");
  assert.equal(normalizeThemePreference("dark"), "dark");
});

test("system theme follows the device until a manual choice is saved", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});
