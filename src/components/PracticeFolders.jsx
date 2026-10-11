import React, { useEffect, useRef, useState } from "react";
import { FolderInput, FolderOpen, FolderPlus, Pencil, Trash2, X } from "lucide-react";

export function PracticeFolderToolbar({ folders, songs, selectedId, isAdmin, busy, onSelect, onAdd, onRename, onDelete }) {
  const selectedFolder = folders.find((folder) => folder.id === selectedId);
  const counts = songs.reduce((totals, song) => {
    const id = song.practiceFolderId || "";
    totals[id] = (totals[id] ?? 0) + 1;
    return totals;
  }, {});

  return (
    <div className="practice-folder-toolbar">
      <FolderOpen size={17} aria-hidden="true" />
      <select aria-label="연습 폴더" value={selectedId} onChange={(event) => onSelect(event.target.value)} disabled={busy}>
        <option value="__all">전체 ({songs.length}곡)</option>
        <option value="">미분류 ({counts[""] ?? 0}곡)</option>
        {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.title} ({counts[folder.id] ?? 0}곡)</option>)}
      </select>
      {isAdmin && (
        <div className="practice-folder-actions">
          <button type="button" title="연습 폴더 만들기" disabled={busy} onClick={onAdd}><FolderPlus size={16} /></button>
          <button type="button" title="연습 폴더 이름 변경" disabled={busy || !selectedFolder} onClick={() => onRename(selectedFolder)}><Pencil size={16} /></button>
          <button type="button" title="연습 폴더 삭제" disabled={busy || !selectedFolder} onClick={() => onDelete(selectedFolder)}><Trash2 size={16} /></button>
        </div>
      )}
    </div>
  );
}

export function PracticeSongFolderDialog({ song, folders, onMove, onClose }) {
  const [folderId, setFolderId] = useState(song.practiceFolderId || "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  async function save(event) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    try {
      await onMove(song, folderId);
      onClose();
    } catch (failure) {
      setError(failure.message);
      setIsSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef} className="practice-folder-dialog" aria-labelledby="practice-folder-dialog-title"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => { event.preventDefault(); if (!isSaving) onClose(); }}
    >
      <form onSubmit={save}>
        <div className="practice-folder-dialog-head">
          <h2 id="practice-folder-dialog-title">연습 폴더로 이동</h2>
          <button type="button" title="폴더 이동창 닫기" onClick={onClose} disabled={isSaving}><X size={19} /></button>
        </div>
        <p className="practice-folder-song-title">{song.title}</p>
        <label htmlFor="practice-folder-destination">이동할 폴더</label>
        <select
          id="practice-folder-destination" value={folderId} disabled={isSaving}
          onChange={(event) => setFolderId(event.target.value)} autoFocus
        >
          <option value="">미분류</option>
          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.title}</option>)}
        </select>
        {error && <p className="practice-folder-error" role="alert">{error}</p>}
        <div className="practice-folder-dialog-actions">
          <button type="button" onClick={onClose} disabled={isSaving}>취소</button>
          <button type="submit" className="practice-folder-save" disabled={isSaving || folderId === (song.practiceFolderId || "")}>
            <FolderInput size={16} />{isSaving ? "이동 중" : "이동"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
