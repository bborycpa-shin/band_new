import { sampleSongs } from "../data/songs";
import { loadFileManifest, manifestFolder, manifestPath } from "./fileManifest";
import { supabase, supabaseConfig } from "./supabase";

const audioExtensions = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm"];
export const practiceFolder = "_practice";

export function songOrderKey(library) {
  return library === "practice" ? "__practiceOrder" : "__order";
}

function hasExtension(name, extensions) {
  return extensions.some((extension) => name.toLowerCase().endsWith(extension));
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

export async function loadSupabaseSongs() {
  if (!supabase) {
    return { songs: sampleSongs, practiceSongs: [], source: "sample", error: "" };
  }

  const audioBucket = supabaseConfig.buckets.audio;

  try {
    const [audioFiles, audioManifest] = await Promise.all([
      listAll(audioBucket),
      loadFileManifest(audioBucket).catch(() => ({}))
    ]);

    const fullAudioFiles = audioFiles.filter((path) => hasExtension(path, audioExtensions));
    function mapLibrary(library) {
      const order = audioManifest[songOrderKey(library)] ?? [];
      const orderedAudioFiles = fullAudioFiles
        .filter((path) => {
          const savedLibrary = audioManifest[path]?.library;
          const songLibrary = savedLibrary === "play" || savedLibrary === "practice"
            ? savedLibrary : path.startsWith(`${practiceFolder}/`) ? "practice" : "play";
          return songLibrary === library;
        })
        .sort((a, b) => {
          const ai = order.indexOf(a);
          const bi = order.indexOf(b);
          if (ai === -1 && bi === -1) return a.localeCompare(b);
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });

      return orderedAudioFiles.map((path, index) => {
        const folder = path.startsWith(`${practiceFolder}/`)
          ? path.split("/").slice(0, 2).join("/")
          : path.includes("/") ? path.split("/")[0] : `song-${index + 1}`;
        const title = audioManifest[path]?.displayName || titleFromPath(path) || folder;

        return {
          id: audioManifest[path]?.songId || folder || `song-${index + 1}`,
          library,
          title,
          artist: "",
          audioPath: path,
          audioUrl: publicUrl(audioBucket, path),
          lyrics: audioManifest[path]?.lyrics || "",
          splitTrackPaths: {},
          splitTracks: {},
          scores: [],
          album: { images: [], youtubeId: "" },
          partsReady: 0
        };
      });
    }

    const mappedSongs = mapLibrary("play");
    const practiceSongs = mapLibrary("practice");

    return {
      songs: mappedSongs,
      practiceSongs,
      practiceError: "",
      source: "supabase",
      error: ""
    };
  } catch (error) {
    return { songs: sampleSongs, practiceSongs: [], source: "sample", error: error.message, practiceError: error.message };
  }
}
