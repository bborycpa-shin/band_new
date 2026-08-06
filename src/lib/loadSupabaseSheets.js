import { loadFileManifest, manifestFolder, manifestPath } from "./fileManifest";
import { supabase, supabaseConfig } from "./supabase";

const sheetExtensions = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];

function hasSheetExtension(path) {
  return sheetExtensions.some((extension) => path.toLowerCase().endsWith(extension));
}

function titleFromPath(path) {
  return path
    .replace(/\.[^.]+$/, "")
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/[-_]+/g, " ")
    .trim();
}

function publicUrl(bucket, path) {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

async function listAll(bucket, prefix = "") {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" }
  });

  if (error) throw error;

  const files = [];
  for (const entry of data ?? []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!prefix && entry.name === manifestFolder) continue;
    if (entry.id === null) {
      files.push(...(await listAll(bucket, path)));
    } else if (path !== manifestPath) {
      files.push(path);
    }
  }
  return files;
}

export async function loadSupabaseSheets() {
  if (!supabase) return { sheets: [], source: "empty", error: "" };

  const bucket = supabaseConfig.buckets.score;

  try {
    const [files, manifest] = await Promise.all([
      listAll(bucket),
      loadFileManifest(bucket).catch(() => ({}))
    ]);
    const sheets = files
      .filter(hasSheetExtension)
      .map((path) => ({
        path,
        label: manifest[path]?.displayName || titleFromPath(path) || path,
        url: publicUrl(bucket, path)
      }));

    return {
      sheets,
      source: sheets.length ? "supabase" : "empty",
      error: ""
    };
  } catch (error) {
    return { sheets: [], source: "empty", error: error.message };
  }
}
