import React, { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, FolderInput, FolderOpen, FolderPlus, ListChecks, Pencil, Trash2, X } from "lucide-react";
import { reorderPracticeSelection } from "../lib/practiceFolders";

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

export function PracticeSelectionToolbar({ songs, selection }) {
  const { active, paths, busy, onToggle, onToggleAll, onMove, onReorder } = selection;
  const count = songs.filter((song) => paths.has(song.audioPath)).length;
  const selectAllRef = useRef(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = count > 0 && count < songs.length;
  }, [count, songs.length]);

  if (!active) {
    return (
      <div className="practice-selection-toolbar">
        <button type="button" onClick={onToggle} disabled={busy || !songs.length}>
          <ListChecks size={17} />여러 곡 선택
        </button>
      </div>
    );
  }

  const orderButtons = [
    ["top", "선택한 곡 맨 위로", ArrowUpToLine],
    ["up", "선택한 곡 위로", ArrowUp],
    ["down", "선택한 곡 아래로", ArrowDown],
    ["bottom", "선택한 곡 맨 아래로", ArrowDownToLine]
  ];
  return (
    <div className="practice-selection-toolbar" aria-label="여러 곡 관리" aria-busy={busy}>
      <label className="practice-select-all">
        <input ref={selectAllRef} type="checkbox" aria-label="현재 폴더 곡 전체 선택"
          checked={songs.length > 0 && count === songs.length} disabled={busy || !songs.length} onChange={onToggleAll} />
        <span aria-live="polite">{count}곡 선택</span>
      </label>
      <div className="practice-selection-actions">
        <button type="button" title="선택한 곡 폴더 이동" disabled={busy || !count} onClick={onMove}><FolderInput size={17} /></button>
        {orderButtons.map(([direction, title, Icon]) => {
          const nextOrder = reorderPracticeSelection(songs, paths, direction);
          const unchanged = nextOrder.every((song, index) => song.audioPath === songs[index].audioPath);
          return <button key={direction} type="button" title={title} disabled={busy || !count || unchanged}
            onClick={() => onReorder(direction)}><Icon size={17} /></button>;
        })}
        <button type="button" title="여러 곡 선택 종료" disabled={busy} onClick={onToggle}><X size={18} /></button>
      </div>
    </div>
  );
}

export function PracticeSongFolderDialog({ songs, folders, onMove, onClose }) {
  const [folderId, setFolderId] = useState(songs[0].practiceFolderId || "");
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
      await onMove(songs, folderId);
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
        <p className="practice-folder-song-title">{songs.length === 1 ? songs[0].title : `${songs.length}곡 선택`}</p>
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
          <button type="submit" className="practice-folder-save" disabled={isSaving || songs.every((song) => folderId === (song.practiceFolderId || ""))}>
            <FolderInput size={16} />{isSaving ? "이동 중" : "이동"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
