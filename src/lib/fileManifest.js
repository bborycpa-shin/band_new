import { supabase } from "./supabase";

export const manifestPath = "_band-player-manifest.json";
export const manifestFolder = "_band-player-manifests";

async function loadManifestSnapshot(bucket) {
  const { data, error } = await supabase.storage.from(bucket).list(manifestFolder, {
    limit: 100,
    sortBy: { column: "name", order: "desc" }
  });

  if (error || !data?.length) return null;

  const latest = data.find((entry) => entry.name.endsWith(".json"));
  if (!latest) return null;

  const { data: file, error: downloadError } = await supabase.storage
    .from(bucket)
    .download(`${manifestFolder}/${latest.name}`);

  if (downloadError || !file) return null;
  return JSON.parse(await file.text());
}

export async function loadFileManifest(bucket) {
  if (!supabase || !bucket) return {};

  try {
    const snapshot = await loadManifestSnapshot(bucket);
    if (snapshot) return snapshot;
  } catch {
    // Fall back to the legacy manifest below.
  }

  const { data, error } = await supabase.storage.from(bucket).download(manifestPath);
  if (error || !data) return {};

  try {
    return JSON.parse(await data.text());
  } catch {
    return {};
  }
}

export async function saveFileManifest(bucket, manifest) {
  if (!supabase || !bucket) return;

  const nextManifest = {
    ...manifest,
    __savedAt: new Date().toISOString()
  };
  const file = new Blob([JSON.stringify(nextManifest, null, 2)], {
    type: "application/json"
  });
  const snapshotPath = `${manifestFolder}/${Date.now()}-${crypto.randomUUID()}.json`;

  const { error } = await supabase.storage.from(bucket).upload(snapshotPath, file, {
    cacheControl: "0",
    contentType: "application/json",
    upsert: false
  });

  if (error) throw error;

  supabase.storage
    .from(bucket)
    .upload(manifestPath, file, {
      cacheControl: "0",
      contentType: "application/json",
      upsert: true
    })
    .catch(() => {});
}

export async function setDisplayName(bucket, path, displayName) {
  const manifest = await loadFileManifest(bucket);
  manifest[path] = {
    ...(manifest[path] ?? {}),
    displayName
  };
  await saveFileManifest(bucket, manifest);
}

export async function moveDisplayName(bucket, oldPath, newPath, displayName) {
  const manifest = await loadFileManifest(bucket);
  const previous = manifest[oldPath] ?? {};
  delete manifest[oldPath];
  manifest[newPath] = {
    ...previous,
    displayName: displayName || previous.displayName || newPath.split("/").pop()
  };
  await saveFileManifest(bucket, manifest);
}

export async function removeDisplayName(bucket, path) {
  const manifest = await loadFileManifest(bucket);
  delete manifest[path];
  await saveFileManifest(bucket, manifest);
}

export async function setManifestOrder(bucket, paths) {
  const manifest = await loadFileManifest(bucket);
  manifest.__order = [...new Set(paths.filter(Boolean))];
  await saveFileManifest(bucket, manifest);
}
