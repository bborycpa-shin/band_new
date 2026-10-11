export function readPracticeFolders(manifest) {
  return Object.entries(manifest.__practiceFolders ?? {})
    .filter(([, folder]) => typeof folder?.title === "string" && folder.title.trim())
    .map(([id, folder]) => ({ id, title: folder.title, createdAt: typeof folder.createdAt === "string" ? folder.createdAt : "" }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title));
}
