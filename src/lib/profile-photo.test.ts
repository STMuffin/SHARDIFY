import test from "node:test";
import assert from "node:assert/strict";
import { decodeProfilePhoto, MAX_PHOTO_BYTES } from "./profile-photo";

test("profile uploads reject non-JPEG payloads", () => {
  assert.throws(() => decodeProfilePhoto(btoa("<svg>not a photo</svg>")));
  assert.deepEqual([...decodeProfilePhoto(btoa(String.fromCharCode(255, 216, 255, 0, 255, 217)))], [255, 216, 255, 0, 255, 217]);
});
test("profile uploads enforce the private bucket size cap", () => {
  assert.throws(() => decodeProfilePhoto("A".repeat(Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 1)));
});