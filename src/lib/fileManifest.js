import { supabase } from "./supabase";

export const manifestPath = "_band-player-manifest.json";

export async function loadFileManifest(bucket) {
  if (!supabase || !bucket) return {};

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

  const file = new Blob([JSON.stringify(manifest, null, 2)], {
    type: "application/json"
  });

  await supabase.storage.from(bucket).upload(manifestPath, file, {
    cacheControl: "60",
    contentType: "application/json",
    upsert: true
  });
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
