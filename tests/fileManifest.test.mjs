import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/lib/fileManifest.js", import.meta.url), "utf8");
async function fixture(initial = {}, shared) {
  const files = shared?.files ?? new Map([["_band-player-manifest.json", JSON.stringify(initial)]]);
  const failures = shared?.failures ?? { list: null, download: null, upload: null };
  const writes = shared?.writes ?? [];
  const storage = { storage: { from() { return {
    async list() {
      return failures.list ? { error: failures.list } : { data: [...files.keys()]
        .filter((path) => path.startsWith("_band-player-manifests/")).sort().reverse()
        .map((path) => ({ name: path.split("/").pop() })), error: null };
    },
    async download(path) {
      if (failures.download) return { error: failures.download };
      return files.has(path) ? { data: new Blob([files.get(path)]), error: null }
        : { error: { statusCode: "404", message: "Object not found" } };
    },
    async upload(path, blob) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (failures.upload && path.startsWith("_band-player-manifests/")) return { error: failures.upload };
      files.set(path, await blob.text());
      writes.push(path);
      return { error: null };
    }
  }; } } };
  const key = `__manifestTest${crypto.randomUUID().replaceAll("-", "")}`;
  globalThis[key] = storage;
  const code = source.replace('import { supabase } from "./supabase";', `const supabase = globalThis["${key}"];`);
  const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  delete globalThis[key];
  return { api, files, failures, writes };
}

test("temporary listing/download failures and corrupt snapshots block every save", async () => {
  const original = { old: { lyrics: "Preserve", displayName: "Original" }, __practiceFolders: { one: { title: "Folder" } } };
  for (const kind of ["list", "download", "corrupt"]) {
    const { api, files, failures, writes } = await fixture(original);
    if (kind === "corrupt") files.set("_band-player-manifests/123-latest.json", "not JSON");
    else failures[kind] = new Error("Temporary offline");
    await assert.rejects(api.setDisplayName("songs", "new", "New"), /변경을 중단/);
    assert.equal(writes.length, 0);
    assert.deepEqual(JSON.parse(files.get("_band-player-manifest.json")), original);
  }
});

test("only a confirmed missing manifest initializes an empty store", async () => {
  const { api, files, failures } = await fixture();
  files.clear();
  assert.deepEqual(await api.loadFileManifest("songs"), {});
  failures.download = { statusCode: "404", message: "Bucket not found" };
  await assert.rejects(api.setDisplayName("songs", "new", "New"), /변경을 중단/);
  failures.download = { statusCode: "403", message: "Forbidden" };
  await assert.rejects(api.loadFileManifest("songs"), /변경을 중단/);
});

test("concurrent title/order/lyrics edits preserve each other and the existing folders", async () => {
  const { api, writes } = await fixture({ old: { displayName: "Original", lyrics: "Lyrics" }, __practiceFolders: { one: { title: "Folder" } } });
  await Promise.all([
    api.setDisplayName("songs", "old", "Renamed"),
    api.setManifestOrder("songs", ["second", "old"]),
    api.updateFileManifest("songs", (manifest) => { manifest.old.lyrics = "Updated lyrics"; })
  ]);
  const saved = await api.loadFileManifest("songs");
  assert.equal(saved.old.displayName, "Renamed");
  assert.equal(saved.old.lyrics, "Updated lyrics");
  assert.equal(saved.__practiceFolders.one.title, "Folder");
  assert.deepEqual(saved.__order, ["second", "old"]);
  assert.equal(writes.filter((path) => path.includes("_band-player-manifests/")).length, 3);
  assert.equal(writes.length, 6);
});

test("a failed write does not poison the queue or discard existing metadata", async () => {
  const { api, failures } = await fixture({ old: { lyrics: "Keep" } });
  failures.upload = new Error("Save failed");
  await assert.rejects(api.setDisplayName("songs", "old", "Not saved"), /Save failed/);
  failures.upload = null;
  await api.setDisplayName("songs", "old", "Saved");
  assert.deepEqual((await api.loadFileManifest("songs")).old, { lyrics: "Keep", displayName: "Saved" });
});

test("a newer external revision is reread and edits are reapplied without losing it", async () => {
  const { api, files } = await fixture({ old: { displayName: "Original" } });
  let calls = 0;
  await api.updateFileManifest("songs", (manifest) => {
    manifest.old.displayName = "Renamed";
    if (++calls === 1) files.set(`_band-player-manifests/${Date.now() + 100}-other.json`, JSON.stringify({ old: { displayName: "Original", lyrics: "Other editor" } }));
  });
  assert.equal(calls, 2);
  assert.deepEqual((await api.loadFileManifest("songs")).old, { displayName: "Renamed", lyrics: "Other editor" });
});

test("snapshot names remain strictly ordered when the wall clock does not advance", async () => {
  const { api, writes } = await fixture();
  const originalNow = Date.now;
  Date.now = () => 1700000000000;
  try {
    await api.setDisplayName("songs", "one", "One");
    await api.setDisplayName("songs", "two", "Two");
  } finally { Date.now = originalNow; }
  const timestamps = writes.filter((path) => path.includes("_band-player-manifests/")).map((path) => Number(path.split("/")[1].split("-")[0]));
  assert(timestamps[1] > timestamps[0]);
  assert.equal((await api.loadFileManifest("songs")).two.displayName, "Two");
});

test("browser locking serializes independent module instances from different tabs", async () => {
  const first = await fixture({ old: { displayName: "Original", lyrics: "Keep" } });
  const second = await fixture({}, first);
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
  let queue = Promise.resolve();
  let locksUsed = 0;
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request(name, operation) {
      assert.equal(name, "band-manifest:songs"); locksUsed++;
      const next = queue.catch(() => {}).then(operation);
      queue = next;
      return next;
    }
  } });
  try {
    await Promise.all([first.api.setDisplayName("songs", "old", "Renamed"), second.api.setManifestOrder("songs", ["other", "old"])]);
    const saved = await first.api.loadFileManifest("songs");
    assert.equal(locksUsed, 2);
    assert.equal(saved.old.displayName, "Renamed");
    assert.equal(saved.old.lyrics, "Keep");
    assert.deepEqual(saved.__order, ["other", "old"]);
  } finally {
    if (descriptor) Object.defineProperty(navigator, "locks", descriptor);
    else delete navigator.locks;
  }
});

test("persistent external conflicts stop editing instead of overwriting newer changes", async () => {
  const { api, files, writes } = await fixture({ old: { displayName: "Original" } });
  let attempts = 0;
  await assert.rejects(api.updateFileManifest("songs", (manifest) => {
    manifest.old.displayName = "Stale edit";
    files.set(`_band-player-manifests/${Date.now() + ++attempts * 100}-remote.json`, JSON.stringify({ old: { displayName: "Remote" } }));
  }), /다른 변경사항/);
  assert.equal(attempts, 3);
  assert.equal(writes.length, 0);
  assert.equal((await api.loadFileManifest("songs")).old.displayName, "Remote");
});
