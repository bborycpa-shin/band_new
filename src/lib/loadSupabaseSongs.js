import { instruments, sampleSongs } from "../data/songs";
import { loadFileManifest, manifestFolder, manifestPath } from "./fileManifest";
import { supabase, supabaseConfig } from "./supabase";

const audioExtensions = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm"];
const scoreExtensions = [".pdf", ".jpg", ".jpeg", ".png"];

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
    return { songs: sampleSongs, source: "sample", error: "" };
  }

  const audioBucket = supabaseConfig.buckets.audio;
  const splitBucket = supabaseConfig.buckets.split;
  const scoreBucket = supabaseConfig.buckets.score;
  const albumBucket = supabaseConfig.buckets.album;

  try {
    const [audioFiles, splitFiles, scoreFiles, albumFiles, audioManifest, scoreManifest] = await Promise.all([
      listAll(audioBucket),
      listAll(splitBucket).catch(() => []),
      listAll(scoreBucket).catch(() => []),
      listAll(albumBucket).catch(() => []),
      loadFileManifest(audioBucket).catch(() => ({})),
      loadFileManifest(scoreBucket).catch(() => ({}))
    ]);

    const fullAudioFiles = audioFiles.filter((path) => hasExtension(path, audioExtensions));
    const orderedAudioFiles = fullAudioFiles.sort((a, b) => {
      const order = audioManifest.__order ?? [];
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    const mappedSongs = orderedAudioFiles.map((path, index) => {
      const folder = path.includes("/") ? path.split("/")[0] : `song-${index + 1}`;
      const title = audioManifest[path]?.displayName || titleFromPath(path) || folder;
      const splitTrackPaths = Object.fromEntries(
        instruments.map((instrument) => {
          const track = splitFiles.find(
            (file) =>
              file.startsWith(`${folder}/`) &&
              (file.toLowerCase().includes(instrument.key) ||
                file.toLowerCase().includes(instrument.label.toLowerCase()))
          );
          return [instrument.key, track || ""];
        })
      );
      const splitTracks = Object.fromEntries(
        instruments.map((instrument) => {
          const track = splitTrackPaths[instrument.key];
          return [instrument.key, track ? publicUrl(splitBucket, track) : publicUrl(audioBucket, path)];
        })
      );
      const scores = scoreFiles
        .filter((file) => file.startsWith(`${folder}/`) && hasExtension(file, scoreExtensions))
        .map((file) => ({
          label: scoreManifest[file]?.displayName || titleFromPath(file) || "악보",
          url: publicUrl(scoreBucket, file)
        }));
      const image = albumFiles.find(
        (file) => file.startsWith(`${folder}/`) && hasExtension(file, [".jpg", ".jpeg", ".png", ".webp"])
      );

      return {
        id: folder || `song-${index + 1}`,
        title,
        artist: "",
        audioPath: path,
        audioUrl: publicUrl(audioBucket, path),
        splitTrackPaths,
        splitTracks,
        scores,
        album: {
          images: image ? [publicUrl(albumBucket, image)] : [],
          youtubeId: ""
        },
        partsReady: Object.values(splitTracks).filter(Boolean).length
      };
    });

    return {
      songs: mappedSongs.length ? mappedSongs : sampleSongs,
      source: mappedSongs.length ? "supabase" : "sample",
      error: mappedSongs.length ? "" : "Supabase에서 음원 파일을 찾지 못해 샘플 목록을 표시합니다."
    };
  } catch (error) {
    return { songs: sampleSongs, source: "sample", error: error.message };
  }
}
