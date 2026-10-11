import assert from "node:assert/strict";
import test from "node:test";
import { mergePracticeSongOrder, reorderPracticeSelection } from "../src/lib/practiceFolders.js";

const songs = "ABCDEF".split("").map((audioPath) => ({ audioPath, lyrics: `${audioPath} lyrics` }));
const order = (items) => items.map((song) => song.audioPath).join("");

test("moves adjacent and separated selections together without reversing them", () => {
  assert.equal(order(reorderPracticeSelection(songs, ["B", "C"], "up")), "BCADEF");
  assert.equal(order(reorderPracticeSelection(songs, ["B", "C"], "down")), "ADBCEF");
  assert.equal(order(reorderPracticeSelection(songs, ["B", "D"], "up")), "BADCEF");
  assert.equal(order(reorderPracticeSelection(songs, ["B", "D"], "down")), "ACBEDF");
  assert.equal(order(reorderPracticeSelection(songs, ["B", "D"], "top")), "BDACEF");
  assert.equal(order(reorderPracticeSelection(songs, ["B", "D"], "bottom")), "ACEFBD");
});

test("preserves every song and both groups' relative order for every selection", () => {
  for (let mask = 0; mask < 2 ** songs.length; mask++) {
    const paths = songs.filter((_, index) => mask & (1 << index)).map((song) => song.audioPath);
    const selected = new Set(paths);
    for (const direction of ["top", "up", "down", "bottom"]) {
      const result = reorderPracticeSelection(songs, selected, direction);
      assert.deepEqual(result.filter((song) => selected.has(song.audioPath)), songs.filter((song) => selected.has(song.audioPath)));
      assert.deepEqual(result.filter((song) => !selected.has(song.audioPath)), songs.filter((song) => !selected.has(song.audioPath)));
      assert.deepEqual(new Set(result), new Set(songs));
      assert.equal(order(songs), "ABCDEF");
    }
  }
});

test("boundary, empty and all-selected operations are harmless", () => {
  assert.equal(order(reorderPracticeSelection(songs, ["A", "B"], "up")), "ABCDEF");
  assert.equal(order(reorderPracticeSelection(songs, ["E", "F"], "down")), "ABCDEF");
  for (const direction of ["top", "up", "down", "bottom"]) {
    assert.equal(order(reorderPracticeSelection(songs, [], direction)), "ABCDEF");
    assert.equal(order(reorderPracticeSelection(songs, songs.map((song) => song.audioPath), direction)), "ABCDEF");
    assert.deepEqual(reorderPracticeSelection([], [], direction), []);
  }
});

test("folder-scoped ordering leaves every other folder's slot unchanged", () => {
  const visible = songs.filter((song) => ["B", "D", "F"].includes(song.audioPath));
  const reordered = reorderPracticeSelection(visible, ["F"], "top");
  const result = mergePracticeSongOrder(songs, reordered);
  assert.equal(order(result), "AFCBED");
  for (const index of [0, 2, 4]) assert.equal(result[index], songs[index]);
  assert.equal(order(result.filter((song) => visible.includes(song))), "FBD");
  assert.deepEqual(new Set(result), new Set(songs));
  assert.equal(order(mergePracticeSongOrder(songs, [])), "ABCDEF");
});
