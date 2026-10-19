import { supabase } from "./supabase";

export const manifestPath = "_band-player-manifest.json";
export const manifestFolder = "_band-player-manifests";
const writeQueues = new Map();
const lastSnapshotTimes = new Map();

function readError(error) {
  return new Error(`저장 정보를 읽을 수 없어 변경을 중단했습니다. 다시 시도해주세요.${error?.message ? ` (${error.message})` : ""}`);
}

async function parseManifest(file) {
  if (!file) throw readError();
  try {
    const manifest = JSON.parse(await file.text());
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("잘못된 저장 정보");
    return manifest;
  } catch (error) {
    throw readError(error);
  }
}

async function loadManifestSnapshot(bucket) {
  const { data, error } = await supabase.storage.from(bucket).list(manifestFolder, {
    limit: 100,
    sortBy: { column: "name", order: "desc" }
  });

  if (error) throw readError(error);
  if (!data?.length) return null;

  const latest = data.find((entry) => entry.name.endsWith(".json"));
  if (!latest) return null;

  const { data: file, error: downloadError } = await supabase.storage
    .from(bucket)
    .download(`${manifestFolder}/${latest.name}`);

  if (downloadError) throw readError(downloadError);
  return { manifest: await parseManifest(file), revision: latest.name };
}

async function loadManifestState(bucket) {
  const snapshot = await loadManifestSnapshot(bucket);
  if (snapshot) return snapshot;
  const { data, error } = await supabase.storage.from(bucket).download(manifestPath);
  if (error) {
    // A confirmed missing object is the only case that initializes a new manifest.
    if (Number(error.statusCode ?? error.status) === 404 && !/bucket/i.test(error.message ?? "")) {
      return { manifest: {}, revision: "empty" };
    }
    throw readError(error);
  }
  const manifest = await parseManifest(data);
  return { manifest, revision: `legacy:${JSON.stringify(manifest)}` };
}

export async function loadFileManifest(bucket) {
  if (!supabase || !bucket) return {};
  return (await loadManifestState(bucket)).manifest;
}

async function persistManifest(bucket, manifest, revision) {
  const nextManifest = {
    ...manifest,
    __savedAt: new Date().toISOString()
  };
  const file = new Blob([JSON.stringify(nextManifest, null, 2)], {
    type: "application/json"
  });
  const timestamp = Math.max(Date.now(), (lastSnapshotTimes.get(bucket) ?? 0) + 1,
    (Number(revision.split("-")[0]) || 0) + 1);
  lastSnapshotTimes.set(bucket, timestamp);
  const snapshotPath = `${manifestFolder}/${timestamp}-${crypto.randomUUID()}.json`;

  const { error } = await supabase.storage.from(bucket).upload(snapshotPath, file, {
    cacheControl: "0",
    contentType: "application/json",
    upsert: false
  });

  if (error) throw error;

  // Snapshots are authoritative; finish the compatibility write before the next edit.
  try {
    await supabase.storage.from(bucket).upload(manifestPath, file, {
      cacheControl: "0",
      contentType: "application/json",
      upsert: true
    });
  } catch {
    // A failed legacy copy must not turn a successfully saved snapshot into a failure.
  }
  return nextManifest;
}

export async function updateFileManifest(bucket, mutate) {
  if (!supabase || !bucket) throw new Error("저장소에 연결되지 않았습니다.");
  const operation = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await loadManifestState(bucket);
      const draft = structuredClone(state.manifest);
      // Mutators only edit metadata, so they can be reapplied to a newer revision.
      await mutate(draft);
      const latest = await loadManifestState(bucket);
      if (latest.revision !== state.revision) continue;
      return persistManifest(bucket, draft, state.revision);
    }
    throw new Error("다른 변경사항이 저장 중입니다. 잠시 후 다시 시도해주세요.");
  };
  const run = () => globalThis.navigator?.locks?.request
    ? navigator.locks.request(`band-manifest:${bucket}`, operation) : operation();
  const pending = (writeQueues.get(bucket) ?? Promise.resolve()).catch(() => {}).then(run);
  writeQueues.set(bucket, pending);
  try {
    return await pending;
  } finally {
    if (writeQueues.get(bucket) === pending) writeQueues.delete(bucket);
  }
}

export async function setDisplayName(bucket, path, displayName, metadata = {}) {
  return updateFileManifest(bucket, (manifest) => {
    manifest[path] = { ...(manifest[path] ?? {}), ...metadata, displayName };
  });
}

export async function moveDisplayName(bucket, oldPath, newPath, displayName) {
  return updateFileManifest(bucket, (manifest) => {
    const previous = manifest[oldPath] ?? {};
    delete manifest[oldPath];
    manifest[newPath] = { ...previous, displayName: displayName || previous.displayName || newPath.split("/").pop() };
  });
}

export async function removeDisplayName(bucket, path) {
  return updateFileManifest(bucket, (manifest) => { delete manifest[path]; });
}

export async function setManifestOrder(bucket, paths, orderKey = "__order") {
  return updateFileManifest(bucket, (manifest) => { manifest[orderKey] = [...new Set(paths.filter(Boolean))]; });
}
