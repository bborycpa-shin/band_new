import { instruments } from "../data/songs";
import { loadFileManifest, manifestFolder, manifestPath } from "./fileManifest";
import { supabase, supabaseConfig } from "./supabase";

const audioExtensions = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm"];

function hasAudioExtension(path) {
  return audioExtensions.some((extension) => path.toLowerCase().endsWith(extension));
}

function titleFromFolder(folder) {
  return folder.replace(/[-_]+/g, " ").trim() || folder;
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

export function createEmptySplitSong(id = "split-empty", title = "분할 곡을 추가해주세요") {
  return {
    id,
    title,
    splitTrackPaths: Object.fromEntries(instruments.map((instrument) => [instrument.key, ""])),
    splitTracks: Object.fromEntries(instruments.map((instrument) => [instrument.key, ""])),
    partsReady: 0,
    scores: [],
    album: { images: [], youtubeId: "" }
  };
}

export async function loadSupabaseSplitSongs() {
  if (!supabase) {
    return { songs: [createEmptySplitSong()], source: "empty", error: "" };
  }

  const bucket = supabaseConfig.buckets.split;

  try {
    const [files, manifest] = await Promise.all([
      listAll(bucket),
      loadFileManifest(bucket).catch(() => ({}))
    ]);
    const songMeta = manifest.__splitSongs ?? {};
    const audioFiles = files.filter(hasAudioExtension);
    const folders = [
      ...new Set([
        ...Object.keys(songMeta),
        ...audioFiles.map((path) => path.split("/")[0]).filter(Boolean)
      ])
    ];
    const order = manifest.__splitOrder ?? [];

    const orderedFolders = folders.sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    const songs = orderedFolders.map((folder) => {
      const splitTrackPaths = Object.fromEntries(
        instruments.map((instrument) => {
          const track = audioFiles.find(
            (file) =>
              file.startsWith(`${folder}/`) &&
              (file.includes(`/${instrument.key}/`) ||
                file.toLowerCase().includes(instrument.label.toLowerCase()))
          );
          return [instrument.key, track || ""];
        })
      );
      const splitTracks = Object.fromEntries(
        instruments.map((instrument) => {
          const track = splitTrackPaths[instrument.key];
          return [instrument.key, track ? publicUrl(bucket, track) : ""];
        })
      );

      return {
        id: folder,
        title: songMeta[folder]?.title || titleFromFolder(folder),
        splitTrackPaths,
        splitTracks,
        partsReady: Object.values(splitTrackPaths).filter(Boolean).length,
        scores: [],
        album: { images: [], youtubeId: "" }
      };
    });

    return {
      songs: songs.length ? songs : [createEmptySplitSong()],
      source: songs.length ? "supabase" : "empty",
      error: ""
    };
  } catch (error) {
    return { songs: [createEmptySplitSong()], source: "empty", error: error.message };
  }
}
