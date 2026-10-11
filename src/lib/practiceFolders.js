export function readPracticeFolders(manifest) {
  return Object.entries(manifest.__practiceFolders ?? {})
    .filter(([, folder]) => typeof folder?.title === "string" && folder.title.trim())
    .map(([id, folder]) => ({ id, title: folder.title, createdAt: typeof folder.createdAt === "string" ? folder.createdAt : "" }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title));
}

export function reorderPracticeSelection(songs, selectedPaths, direction) {
  const selected = new Set(selectedPaths);
  const isSelected = (song) => selected.has(song.audioPath);
  if (direction === "top" || direction === "bottom") {
    const chosen = songs.filter(isSelected);
    const remaining = songs.filter((song) => !isSelected(song));
    return direction === "top" ? [...chosen, ...remaining] : [...remaining, ...chosen];
  }

  const reordered = [...songs];
  if (direction === "up") {
    for (let index = 1; index < reordered.length; index++) {
      if (isSelected(reordered[index]) && !isSelected(reordered[index - 1])) {
        [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
      }
    }
  } else if (direction === "down") {
    for (let index = reordered.length - 2; index >= 0; index--) {
      if (isSelected(reordered[index]) && !isSelected(reordered[index + 1])) {
        [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];
      }
    }
  }
  return reordered;
}

export function mergePracticeSongOrder(allSongs, visibleSongs) {
  const paths = new Set(visibleSongs.map((song) => song.audioPath));
  let index = 0;
  // Only replace the current folder's slots; other folders keep their positions.
  return allSongs.map((song) => paths.has(song.audioPath) ? visibleSongs[index++] : song);
}
