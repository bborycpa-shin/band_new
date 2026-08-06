import { instruments, sampleSongs } from "../data/songs";
import { supabase, supabaseConfig } from "./supabase";

const audioExtensions = [".mp3", ".wav", ".m4a", ".ogg", ".flac"];
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
    if (entry.id === null) {
      files.push(...(await listAll(bucket, path)));
    } else {
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
  const scoreBucket = supabaseConfig.buckets.score;
  const albumBucket = supabaseConfig.buckets.album;

  try {
    const [audioFiles, scoreFiles, albumFiles] = await Promise.all([
      listAll(audioBucket),
      listAll(scoreBucket).catch(() => []),
      listAll(albumBucket).catch(() => [])
    ]);

    const fullAudioFiles = audioFiles.filter((path) => hasExtension(path, audioExtensions));
    const mappedSongs = fullAudioFiles.map((path, index) => {
      const folder = path.includes("/") ? path.split("/")[0] : `song-${index + 1}`;
      const title = titleFromPath(path) || folder;
      const splitTracks = Object.fromEntries(
        instruments.map((instrument) => {
          const track = audioFiles.find(
            (file) => file.startsWith(`${folder}/`) && file.toLowerCase().includes(instrument.key)
          );
          return [instrument.key, track ? publicUrl(audioBucket, track) : publicUrl(audioBucket, path)];
        })
      );
      const scores = scoreFiles
        .filter((file) => file.startsWith(`${folder}/`) && hasExtension(file, scoreExtensions))
        .map((file) => ({ label: titleFromPath(file) || "악보", url: publicUrl(scoreBucket, file) }));
      const image = albumFiles.find(
        (file) => file.startsWith(`${folder}/`) && hasExtension(file, [".jpg", ".jpeg", ".png", ".webp"])
      );

      return {
        id: folder || `song-${index + 1}`,
        title,
        artist: "",
        audioUrl: publicUrl(audioBucket, path),
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
