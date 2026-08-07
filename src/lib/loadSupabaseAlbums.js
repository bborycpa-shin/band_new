import { loadFileManifest, manifestFolder, manifestPath } from "./fileManifest";
import { supabase, supabaseConfig } from "./supabase";

const imageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

function hasImageExtension(path) {
  return imageExtensions.some((extension) => path.toLowerCase().endsWith(extension));
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

function titleFromFolder(folder) {
  return folder.replace(/[-_]+/g, " ").trim() || folder;
}

function publicUrl(bucket, path) {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

function uploadedTimeFromPath(path) {
  const fileName = path.split("/").pop() || "";
  const time = Number(fileName.split("-")[0]);
  return Number.isFinite(time) ? time : 0;
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

export function createEmptyAlbum(id = "album-empty", title = "사진 폴더를 추가해주세요") {
  return { id, title, question: "", answer: "", images: [] };
}

export async function loadSupabaseAlbums() {
  if (!supabase) return { albums: [createEmptyAlbum()], source: "empty", error: "" };

  const bucket = supabaseConfig.buckets.album;

  try {
    const [files, manifest] = await Promise.all([
      listAll(bucket),
      loadFileManifest(bucket).catch(() => ({}))
    ]);
    const albumMeta = manifest.__albumFolders ?? {};
    const imageFiles = files.filter(
      (path) => path.includes("/") && !path.includes("/.thumbs/") && hasImageExtension(path)
    );
    const thumbnailFiles = files.filter((path) => path.includes("/.thumbs/") && hasImageExtension(path));
    const folders = [
      ...new Set([
        ...Object.keys(albumMeta),
        ...imageFiles.map((path) => path.split("/")[0]).filter(Boolean)
      ])
    ];
    const order = manifest.__albumOrder ?? [];

    const orderedFolders = folders.sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    const albums = orderedFolders.map((folder) => ({
      id: folder,
      title: albumMeta[folder]?.title || titleFromFolder(folder),
      question: albumMeta[folder]?.question || "",
      answer: albumMeta[folder]?.answer || "",
      images: imageFiles
        .filter((path) => path.startsWith(`${folder}/`))
        .sort((a, b) => uploadedTimeFromPath(b) - uploadedTimeFromPath(a) || b.localeCompare(a))
        .map((path) => {
          const fileName = path.split("/").pop();
          const thumbnailPath = thumbnailFiles.find((thumbnail) => thumbnail === `${folder}/.thumbs/${fileName}`);
          return {
            path,
            thumbnailPath: thumbnailPath || "",
            label: manifest[path]?.displayName || titleFromPath(path) || path,
            url: publicUrl(bucket, path),
            thumbnailUrl: thumbnailPath ? publicUrl(bucket, thumbnailPath) : publicUrl(bucket, path)
          };
        })
    }));

    return {
      albums: albums.length ? albums : [createEmptyAlbum()],
      source: albums.length ? "supabase" : "empty",
      error: ""
    };
  } catch (error) {
    return { albums: [createEmptyAlbum()], source: "empty", error: error.message };
  }
}
