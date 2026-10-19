import assert from "node:assert/strict";
import test from "node:test";
import { replaceSongAudioMetadata } from "../src/lib/songAudio.js";

test("replacement keeps identity, lyrics, folder and both ordering lists", () => {
  const manifest = { old: { displayName: "Old", lyrics: "Keep", library: "practice", practiceFolderId: "folder", scoreFolder: "scores" },
    __order: ["other", "old"], __practiceOrder: ["one", "old", "two"] };
  replaceSongAudioMetadata(manifest, { id: "stable-id", audioPath: "old" }, "new", "New");
  assert.deepEqual(manifest.new, { displayName: "New", lyrics: "Keep", library: "practice", practiceFolderId: "folder", scoreFolder: "scores", songId: "stable-id" });
  assert.equal(manifest.old.replacedBy, "new");
  assert.deepEqual(manifest.__order, ["other", "new"]);
  assert.deepEqual(manifest.__practiceOrder, ["one", "new", "two"]);
  assert.throws(() => replaceSongAudioMetadata(manifest, { id: "stable-id", audioPath: "old" }, "third", "Third"), /이미 교체/);
  assert.equal(manifest.third, undefined);
});
