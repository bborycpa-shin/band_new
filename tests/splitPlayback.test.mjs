import assert from "node:assert/strict";
import test from "node:test";
import { getSplitAudios, getSplitClock, playSplitAudioGroup } from "../src/lib/splitPlayback.js";

function audio(key, duration, fails = false, songId = "song") {
  return { dataset: { instrument: key, songId }, duration, currentTime: 0, error: null, paused: true,
    async play() { if (fails) throw new Error("Unavailable"); this.paused = false; }, pause() { this.paused = true; } };
}
const song = { id: "song", splitTracks: { guitar: "guitar.wav", bass: "bass.wav", vocal: "" } };

test("uses the longest available track as the clock, without requiring vocals", () => {
  const refs = { guitar: audio("guitar", 12), bass: audio("bass", 10), vocal: audio("vocal", 0), drums: audio("drums", 99, false, "previous-song") };
  assert.equal(getSplitAudios(refs, song).length, 2);
  assert.equal(getSplitClock(refs, song).key, "guitar");
  assert.equal(getSplitClock(refs, song).duration, 12);
  refs.guitar.error = new Error("Broken");
  assert.equal(getSplitClock(refs, song).key, "bass");
});

test("any rejected playback stops the entire group instead of reporting success", async () => {
  for (const allFail of [false, true]) {
    const group = [audio("guitar", 12, allFail), audio("bass", 10, true)];
    await assert.rejects(playSplitAudioGroup(group, 0, () => {}), /재생하지 못했습니다/);
    assert(group.every((item) => item.paused));
  }
});

test("successful playback seeks and configures every playable track", async () => {
  const group = [audio("guitar", 12), audio("bass", 10)];
  assert.equal(await playSplitAudioGroup(group, 3, (item) => { item.volume = 0.3; }), true);
  assert(group.every((item) => !item.paused && item.currentTime === 3 && item.volume === 0.3));
});

test("expired requests cannot mark newer playback failed or stop its audio", async () => {
  const group = [audio("guitar", 12)];
  assert.equal(await playSplitAudioGroup(group, 0, () => {}, () => false), false);
  assert.equal(group[0].paused, false);
});

test("empty groups and tracks already ended at a seek position do not restart", async () => {
  assert.equal(await playSplitAudioGroup([], 0, () => {}), false);
  const group = [audio("guitar", 12), audio("bass", 3)];
  assert.equal(await playSplitAudioGroup(group, 5, () => {}), true);
  assert.equal(group[0].paused, false);
  assert.equal(group[1].paused, true);
});
