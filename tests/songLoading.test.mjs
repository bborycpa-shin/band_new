import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/lib/loadSupabaseSongs.js", import.meta.url), "utf8");
async function load(paths, manifest, error) {
  const storage = { storage: { from() { return {
    async list(prefix = "") {
      const entries = new Map();
      for (const path of paths) {
        const base = prefix ? `${prefix}/` : "";
        if (!path.startsWith(base)) continue;
        const remaining = path.slice(base.length);
        const name = remaining.split("/")[0];
        entries.set(name, { name, id: remaining.includes("/") ? null : name });
      }
      return { data: [...entries.values()], error: null };
    },
    getPublicUrl(path) { return { data: { publicUrl: `https://example.invalid/${path}` } }; }
  }; } } };
  const key = `__songLoading${crypto.randomUUID().replaceAll("-", "")}`;
  globalThis[key] = { storage, manifest, error };
  const prelude = `const fixture = globalThis["${key}"];
    const supabase = fixture.storage; const supabaseConfig = { buckets: { audio: "songs" } };
    const sampleSongs = [{id:"sample"}]; const manifestFolder = "_band-player-manifests"; const manifestPath = "_band-player-manifest.json";
    const loadFileManifest = async () => { if (fixture.error) throw fixture.error; return fixture.manifest; };
    const readPracticeFolders = () => Object.entries(fixture.manifest.__practiceFolders || {}).map(([id, folder])=>({id,...folder}));\n`;
  const code = prelude + source.replace(/^import .+;\r?\n/gm, "");
  const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  delete globalThis[key];
  return api.loadSupabaseSongs();
}

test("legacy files in the same folder have independent IDs and retain their score folder", async () => {
  const result = await load(["song/full/old.mp3", "song/full/other.mp3"], {});
  assert.equal(result.songs.length, 2);
  assert.equal(new Set(result.songs.map((song) => song.id)).size, 2);
  assert(result.songs.every((song) => song.scoreFolder === "song"));
});

test("superseded files remain hidden even when binary cleanup failed", async () => {
  const result = await load(["song/full/old.mp3", "song/full/new.mp3"], {
    "song/full/old.mp3": { replacedBy: "song/full/new.mp3" },
    "song/full/new.mp3": { songId: "stable", lyrics: "Preserve", displayName: "New", scoreFolder: "original-scores" }
  });
  assert.equal(result.songs.length, 1);
  assert.equal(result.songs[0].id, "stable");
  assert.equal(result.songs[0].lyrics, "Preserve");
  assert.equal(result.songs[0].scoreFolder, "original-scores");
});

test("metadata errors are reported, never used to construct misleading default lists", async () => {
  const result = await load(["song/full/old.mp3"], {}, new Error("Temporary offline"));
  assert.equal(result.source, "error");
  assert.equal(result.error, "Temporary offline");
  assert.deepEqual(result.songs, []);
});
