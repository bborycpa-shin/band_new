export function replaceSongAudioMetadata(manifest, song, path, displayName) {
  const previous = manifest[song.audioPath] ?? {};
  if (previous.replacedBy) throw new Error("이미 교체된 음원입니다. 목록을 새로고침해주세요.");
  const library = previous.library || song.library || "play";
  manifest[path] = {
    ...previous, displayName, library, songId: song.id,
    scoreFolder: previous.scoreFolder || song.scoreFolder || song.id,
    practiceFolderId: previous.practiceFolderId ?? song.practiceFolderId ?? ""
  };
  manifest[song.audioPath] = { ...previous, replacedBy: path };
  for (const key of ["__order", "__practiceOrder"]) {
    if (Array.isArray(manifest[key])) {
      manifest[key] = [...new Set(manifest[key].map((item) => item === song.audioPath ? path : item))];
    }
  }
  const orderKey = library === "practice" ? "__practiceOrder" : "__order";
  if (!manifest[orderKey]?.includes(path)) manifest[orderKey] = [path, ...(manifest[orderKey] ?? [])];
}
