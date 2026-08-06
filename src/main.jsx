import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Download,
  Gauge,
  Image,
  ListMusic,
  Music2,
  Pause,
  Pencil,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  Users,
  Volume2
} from "lucide-react";
import { supabase, supabaseConfig } from "./lib/supabase";
import { loadSupabaseSongs } from "./lib/loadSupabaseSongs";
import { instruments, sampleSongs } from "./data/songs";
import "./styles.css";

const tabs = [
  { key: "play", label: "재생", icon: ListMusic },
  { key: "split", label: "분할", icon: SlidersHorizontal },
  { key: "score", label: "악보", icon: Download },
  { key: "album", label: "앨범", icon: Image },
  { key: "upload", label: "업로드", icon: UploadCloud },
  { key: "member", label: "멤버", icon: Users }
];

const rates = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5, 2];

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeName(value) {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return cleaned || "file";
}

function safeFileName(file) {
  const extension = file.name.includes(".") ? `.${file.name.split(".").pop().toLowerCase()}` : "";
  const baseName = file.name.replace(/\.[^.]+$/, "");
  const cleanBase = safeName(baseName);
  return cleanBase === "file" ? `upload${extension}` : `${cleanBase}${extension}`;
}

function App() {
  const [activeTab, setActiveTab] = useState("play");
  const [appSongs, setAppSongs] = useState(sampleSongs);
  const [libraryStatus, setLibraryStatus] = useState("샘플 목록");
  const [selectedId, setSelectedId] = useState(sampleSongs[0].id);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(0.7);
  const [shuffle, setShuffle] = useState(false);
  const [abLoop, setAbLoop] = useState({ start: null, end: null });
  const [splitVolumes, setSplitVolumes] = useState(() =>
    Object.fromEntries(instruments.map((instrument) => [instrument.key, 0.7]))
  );
  const audioRef = useRef(null);
  const splitRefs = useRef({});

  const selectedSong = useMemo(
    () => appSongs.find((song) => song.id === selectedId) ?? appSongs[0],
    [appSongs, selectedId]
  );

  async function refreshLibrary(nextSelectedId = selectedId) {
    const result = await loadSupabaseSongs();
    setAppSongs(result.songs);
    setSelectedId(
      result.songs.some((song) => song.id === nextSelectedId)
        ? nextSelectedId
        : result.songs[0]?.id ?? sampleSongs[0].id
    );
    if (result.source === "supabase") {
      setLibraryStatus(`Supabase ${result.songs.length}곡`);
    } else {
      setLibraryStatus(result.error ? `샘플 목록: ${result.error}` : "샘플 목록");
    }
  }

  useEffect(() => {
    refreshLibrary(sampleSongs[0].id);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = rate;
    audio.volume = volume;
  }, [rate, volume]);

  useEffect(() => {
    instruments.forEach((instrument) => {
      const audio = splitRefs.current[instrument.key];
      if (!audio) return;
      audio.playbackRate = rate;
      audio.volume = splitVolumes[instrument.key];
    });
  }, [rate, splitVolumes, selectedSong]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAbLoop({ start: null, end: null });
  }, [selectedId]);

  function selectSong(song) {
    setSelectedId(song.id);
  }

  async function togglePlay() {
    if (activeTab === "split") {
      await toggleSplitPlay();
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      await audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }

  async function toggleSplitPlay() {
    const activeAudios = instruments
      .map((instrument) => splitRefs.current[instrument.key])
      .filter(Boolean);

    if (!activeAudios.length) return;

    if (isPlaying) {
      activeAudios.forEach((audio) => audio.pause());
      setIsPlaying(false);
      return;
    }

    activeAudios.forEach((audio) => {
      audio.currentTime = currentTime;
      audio.playbackRate = rate;
      audio.volume = splitVolumes[audio.dataset.instrument] ?? 0.7;
    });
    await Promise.allSettled(activeAudios.map((audio) => audio.play()));
    setIsPlaying(true);
  }

  function seekBy(seconds) {
    if (activeTab === "split") {
      const next = clamp(currentTime + seconds, 0, duration || 999999);
      instruments.forEach((instrument) => {
        const audio = splitRefs.current[instrument.key];
        if (audio) audio.currentTime = next;
      });
      setCurrentTime(next);
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = clamp(audio.currentTime + seconds, 0, audio.duration || 999999);
  }

  function seekTo(value) {
    const next = Number(value);
    if (activeTab === "split") {
      instruments.forEach((instrument) => {
        const audio = splitRefs.current[instrument.key];
        if (audio) audio.currentTime = next;
      });
      setCurrentTime(next);
      return;
    }
    if (audioRef.current) audioRef.current.currentTime = next;
  }

  function moveSong(offset) {
    if (shuffle && offset > 0 && appSongs.length > 1) {
      const candidates = appSongs.filter((song) => song.id !== selectedSong.id);
      setSelectedId(candidates[Math.floor(Math.random() * candidates.length)].id);
      return;
    }

    const currentIndex = appSongs.findIndex((song) => song.id === selectedSong.id);
    const nextIndex = (currentIndex + offset + appSongs.length) % appSongs.length;
    setSelectedId(appSongs[nextIndex].id);
  }

  function markAbLoop() {
    setAbLoop((current) => {
      if (current.start === null) return { start: currentTime, end: null };
      if (current.end === null && currentTime > current.start + 1) {
        return { start: current.start, end: currentTime };
      }
      return { start: null, end: null };
    });
  }

  function handleTrackedTime(time) {
    if (abLoop.start !== null && abLoop.end !== null && time >= abLoop.end) {
      seekTo(abLoop.start);
      return;
    }
    setCurrentTime(time);
  }

  function setAllSplitVolumes(value) {
    setSplitVolumes(Object.fromEntries(instruments.map((instrument) => [instrument.key, value])));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Band Player</p>
          <h1>계단밑딴따라</h1>
        </div>
        <button className="icon-button" title="설정">
          <Gauge size={19} />
        </button>
      </header>

      <nav className="tabbar" aria-label="주요 메뉴">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              className={activeTab === tab.key ? "tab active" : "tab"}
              onClick={() => setActiveTab(tab.key)}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <main className="content">
        {activeTab === "play" && (
          <PlayList
            songs={appSongs}
            selectedSong={selectedSong}
            onSelect={selectSong}
            libraryStatus={libraryStatus}
          />
        )}
        {activeTab === "split" && (
          <SplitPanel
            songs={appSongs}
            selectedSong={selectedSong}
            onSelect={selectSong}
            splitRefs={splitRefs}
            splitVolumes={splitVolumes}
            setSplitVolumes={setSplitVolumes}
            setAllSplitVolumes={setAllSplitVolumes}
            setCurrentTime={handleTrackedTime}
            setDuration={setDuration}
            setIsPlaying={setIsPlaying}
          />
        )}
        {activeTab === "score" && <ScorePanel songs={appSongs} selectedSong={selectedSong} onSelect={selectSong} />}
        {activeTab === "album" && <AlbumPanel songs={appSongs} selectedSong={selectedSong} onSelect={selectSong} />}
        {activeTab === "upload" && <UploadPanel selectedSong={selectedSong} onLibraryRefresh={refreshLibrary} />}
        {activeTab === "member" && <MemberPanel />}
      </main>

      <PlayerBar
        selectedSong={selectedSong}
        audioRef={audioRef}
        activeTab={activeTab}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        duration={duration}
        setDuration={setDuration}
        currentTime={currentTime}
        handleTrackedTime={handleTrackedTime}
        rate={rate}
        setRate={setRate}
        volume={volume}
        setVolume={setVolume}
        shuffle={shuffle}
        setShuffle={setShuffle}
        abLoop={abLoop}
        markAbLoop={markAbLoop}
        togglePlay={togglePlay}
        seekBy={seekBy}
        seekTo={seekTo}
        moveSong={moveSong}
      />
    </div>
  );
}

function PlayList({ songs, selectedSong, onSelect, libraryStatus }) {
  return (
    <section className="panel">
      <div className="section-title">
        <h2>플레이리스트</h2>
        <span>{libraryStatus}</span>
      </div>
      <SongList songs={songs} selectedSong={selectedSong} onSelect={onSelect} mode="play" />
    </section>
  );
}

function SongList({ songs, selectedSong, onSelect, mode }) {
  return (
    <div className="song-list">
      {songs.map((song, index) => (
        <button
          key={song.id}
          className={selectedSong.id === song.id ? "song-row selected" : "song-row"}
          onClick={() => onSelect(song)}
        >
          <span className="drag-handle">::</span>
          <span className="song-number">{index + 1}</span>
          <span className="song-name">{song.title}</span>
          <span className="song-meta">{mode === "split" ? `${song.partsReady}/6` : song.scores.length}</span>
        </button>
      ))}
    </div>
  );
}

function SplitPanel({
  songs,
  selectedSong,
  onSelect,
  splitRefs,
  splitVolumes,
  setSplitVolumes,
  setAllSplitVolumes,
  setCurrentTime,
  setDuration,
  setIsPlaying
}) {
  return (
    <section className="split-layout">
      <div className="panel compact">
        <div className="section-title">
          <h2>분할 재생</h2>
          <span>{selectedSong.partsReady}/6</span>
        </div>
        <SongList songs={songs} selectedSong={selectedSong} onSelect={onSelect} mode="split" />
      </div>

      <div className="panel">
        <div className="detail-head">
          <Music2 size={18} />
          <strong>{selectedSong.title}</strong>
        </div>

        <div className="mixer">
          {instruments.map((instrument) => (
            <div className="track-row" key={instrument.key}>
              <label>{instrument.label}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={splitVolumes[instrument.key]}
                onChange={(event) =>
                  setSplitVolumes((current) => ({
                    ...current,
                    [instrument.key]: Number(event.target.value)
                  }))
                }
              />
              <span>{Math.round(splitVolumes[instrument.key] * 100)}%</span>
              <audio
                data-instrument={instrument.key}
                ref={(node) => {
                  if (node) splitRefs.current[instrument.key] = node;
                }}
                src={selectedSong.splitTracks[instrument.key]}
                preload="metadata"
                onLoadedMetadata={(event) => {
                  if (instrument.key === "vocal") setDuration(event.currentTarget.duration);
                }}
                onTimeUpdate={(event) => {
                  if (instrument.key === "vocal") setCurrentTime(event.currentTarget.currentTime);
                }}
                onEnded={() => setIsPlaying(false)}
              />
            </div>
          ))}
        </div>

        <div className="preset-row" aria-label="전체 볼륨">
          <span>전체 볼륨</span>
          {[0, 0.3, 0.5, 0.7, 1].map((preset) => (
            <button key={preset} onClick={() => setAllSplitVolumes(preset)}>
              {Math.round(preset * 100)}%
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ScorePanel({ songs, selectedSong, onSelect }) {
  return (
    <section className="split-layout">
      <div className="panel compact">
        <div className="section-title">
          <h2>악보</h2>
          <span>다운로드</span>
        </div>
        <SongList songs={songs} selectedSong={selectedSong} onSelect={onSelect} />
      </div>
      <div className="panel">
        <div className="detail-head">
          <Download size={18} />
          <strong>{selectedSong.title}</strong>
        </div>
        <div className="score-list">
          {selectedSong.scores.map((score) => (
            <a className="score-row" href={score.url} download key={score.url}>
              <span>{score.label}</span>
              <Download size={16} />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function AlbumPanel({ songs, selectedSong, onSelect }) {
  return (
    <section className="split-layout">
      <div className="panel compact">
        <div className="section-title">
          <h2>앨범</h2>
          <span>사진/영상</span>
        </div>
        <SongList songs={songs} selectedSong={selectedSong} onSelect={onSelect} />
      </div>
      <div className="panel album-panel">
        {selectedSong.album.images[0] && (
          <img src={selectedSong.album.images[0]} alt={`${selectedSong.title} 앨범 사진`} />
        )}
        {selectedSong.album.youtubeId ? (
          <iframe
            title={`${selectedSong.title} 영상`}
            src={`https://www.youtube.com/embed/${selectedSong.album.youtubeId}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className="notice">등록된 유튜브 영상이 없습니다.</div>
        )}
      </div>
    </section>
  );
}

function UploadPanel({ selectedSong, onLibraryRefresh }) {
  const [category, setCategory] = useState("audio");
  const [instrument, setInstrument] = useState("vocal");
  const [songSlug, setSongSlug] = useState(selectedSong.id);
  const [queue, setQueue] = useState([]);
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [message, setMessage] = useState("");
  const [editingPath, setEditingPath] = useState("");
  const [editingName, setEditingName] = useState("");
  const [savingPath, setSavingPath] = useState("");

  useEffect(() => {
    setSongSlug(selectedSong.id);
  }, [selectedSong.id]);

  const bucket = supabaseConfig.buckets[category];
  const canUpload = Boolean(supabase && bucket);

  useEffect(() => {
    refreshFiles();
  }, [category]);

  function addFiles(fileList) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setQueue((current) => [
      ...current,
      ...files.map((file) => ({
        file,
        status: "대기",
        path: buildPath(file),
        publicUrl: ""
      }))
    ]);
  }

  function buildPath(file) {
    const cleanSong = safeName(songSlug || selectedSong.id || "song");
    const cleanFile = safeFileName(file);
    if (category === "split") return `${cleanSong}/${instrument}/${Date.now()}-${cleanFile}`;
    if (category === "score") return `${cleanSong}/${Date.now()}-${cleanFile}`;
    if (category === "album") return `${cleanSong}/${Date.now()}-${cleanFile}`;
    return `${cleanSong}/full/${Date.now()}-${cleanFile}`;
  }

  async function listStorageFiles(prefix = "") {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" }
    });

    if (error) throw error;

    const nextFiles = [];
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        nextFiles.push(...(await listStorageFiles(path)));
      } else {
        nextFiles.push({
          name: entry.name,
          path,
          size: entry.metadata?.size ?? 0,
          updatedAt: entry.updated_at ?? entry.created_at ?? ""
        });
      }
    }
    return nextFiles;
  }

  async function refreshFiles() {
    if (!canUpload) {
      setFiles([]);
      return;
    }

    setIsLoadingFiles(true);
    try {
      setFiles(await listStorageFiles());
    } catch (error) {
      setMessage(`파일 목록 조회 실패: ${error.message}`);
    } finally {
      setIsLoadingFiles(false);
    }
  }

  async function uploadAll() {
    if (!canUpload) {
      setMessage(".env.local에 Supabase 설정을 먼저 넣어주세요.");
      return;
    }

    setMessage("업로드 중입니다...");
    const nextQueue = [];

    for (const item of queue) {
      const path = item.path || buildPath(item.file);
      const { error } = await supabase.storage.from(bucket).upload(path, item.file, {
        cacheControl: "3600",
        upsert: true
      });

      if (error) {
        nextQueue.push({ ...item, path, status: `실패: ${error.message}` });
        continue;
      }

      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      nextQueue.push({ ...item, path, status: "완료", publicUrl: data.publicUrl });
    }

    setQueue(nextQueue);
    setMessage("업로드 처리가 끝났습니다.");
    await refreshFiles();
    if (category === "audio") {
      await onLibraryRefresh(nextQueue.find((item) => item.status === "완료")?.path?.split("/")[0]);
    }
  }

  async function deleteFile(path) {
    if (!canUpload) return;
    const ok = window.confirm(`${path} 파일을 삭제할까요?`);
    if (!ok) return;

    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) {
      setMessage(`삭제 실패: ${error.message}`);
      return;
    }

    setMessage("파일을 삭제했습니다.");
    await refreshFiles();
    if (category === "audio") await onLibraryRefresh();
  }

  async function renameFile(path) {
    if (!canUpload || !editingName.trim()) return;
    setSavingPath(path);
    setMessage("파일명을 변경하는 중입니다...");

    const parts = path.split("/");
    const currentName = parts[parts.length - 1];
    const currentExtension = currentName.includes(".") ? `.${currentName.split(".").pop()}` : "";
    const nextName = safeName(editingName);
    parts[parts.length - 1] = nextName.includes(".") || !currentExtension ? nextName : `${nextName}${currentExtension}`;
    const nextPath = parts.join("/");

    if (nextPath === path) {
      setEditingPath("");
      setEditingName("");
      setSavingPath("");
      return;
    }

    const { error: moveError } = await supabase.storage.from(bucket).move(path, nextPath);
    if (moveError) {
      const oldUrl = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
      const fileResponse = await fetch(oldUrl);
      if (!fileResponse.ok) {
        setMessage(`이름 변경 실패: ${moveError.message}`);
        setSavingPath("");
        return;
      }

      const blob = await fileResponse.blob();
      const { error: uploadError } = await supabase.storage.from(bucket).upload(nextPath, blob, {
        cacheControl: "3600",
        upsert: true,
        contentType: blob.type || "application/octet-stream"
      });

      if (uploadError) {
        setMessage(`이름 변경 실패: ${uploadError.message}`);
        setSavingPath("");
        return;
      }

      await supabase.storage.from(bucket).remove([path]);
    }

    setMessage("파일명을 변경했습니다.");
    setEditingPath("");
    setEditingName("");
    setSavingPath("");
    await refreshFiles();
    if (category === "audio") await onLibraryRefresh();
  }

  return (
    <section className="panel upload-panel">
      <div className="section-title">
        <h2>파일 업로드</h2>
        <span>{bucket || "설정 필요"}</span>
      </div>

      {!canUpload && (
        <div className="notice">
          Supabase 연결 정보가 아직 없습니다. `.env.local`에 URL, anon key, 버킷명을 넣으면 실제 업로드가
          됩니다.
        </div>
      )}

      <div className="upload-controls">
        <label>
          종류
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="audio">전체 음원</option>
            <option value="split">분할 음원</option>
            <option value="score">악보</option>
            <option value="album">앨범 사진</option>
          </select>
        </label>

        {category === "split" && (
          <label>
            악기
            <select value={instrument} onChange={(event) => setInstrument(event.target.value)}>
              {instruments.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          곡 폴더
          <input value={songSlug} onChange={(event) => setSongSlug(event.target.value)} />
        </label>
      </div>

      <label
        className={isDragging ? "drop-zone dragging" : "drop-zone"}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        <UploadCloud size={30} />
        <strong>파일을 여기에 드래그하거나 눌러서 선택</strong>
        <span>PC의 mp3, wav, pdf, jpg, png 파일을 여러 개 올릴 수 있습니다.</span>
        <input type="file" multiple onChange={(event) => addFiles(event.target.files)} />
      </label>

      <div className="upload-actions">
        <button onClick={uploadAll} disabled={!queue.length}>
          업로드 시작
        </button>
        <button onClick={() => setQueue([])} disabled={!queue.length}>
          목록 비우기
        </button>
        <button onClick={refreshFiles} disabled={!canUpload || isLoadingFiles}>
          파일 새로고침
        </button>
      </div>

      {message && <p className="upload-message">{message}</p>}

      <div className="upload-list">
        {queue.map((item, index) => (
          <div className="upload-row" key={`${item.file.name}-${index}`}>
            <div>
              <strong>{item.file.name}</strong>
              <span>{item.path}</span>
              {item.publicUrl && <a href={item.publicUrl}>{item.publicUrl}</a>}
            </div>
            <em>{item.status}</em>
          </div>
        ))}
      </div>

      <div className="section-title file-manager-title">
        <h2>버킷 파일 관리</h2>
        <span>{isLoadingFiles ? "불러오는 중" : `${files.length}개`}</span>
      </div>

      <div className="upload-list">
        {files.map((file) => (
          <div className="upload-row file-row" key={file.path}>
            <div>
              {editingPath === file.path ? (
                <input
                  className="rename-input"
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                />
              ) : (
                <strong>{file.name}</strong>
              )}
              <span>{file.path}</span>
            </div>
            <div className="file-actions">
              {editingPath === file.path ? (
                <>
                  <button
                    type="button"
                    disabled={savingPath === file.path}
                    onClick={() => renameFile(file.path)}
                  >
                    {savingPath === file.path ? "저장중" : "저장"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingPath("");
                      setEditingName("");
                    }}
                  >
                    취소
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    title="파일명 변경"
                    onClick={() => {
                      setEditingPath(file.path);
                      setEditingName(file.name);
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button type="button" title="삭제" onClick={() => deleteFile(file.path)}>
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MemberPanel() {
  return (
    <section className="panel empty-panel">
      <Users size={36} />
      <h2>멤버</h2>
      <p>초안에서는 멤버 공간만 마련했습니다.</p>
    </section>
  );
}

function PlayerBar({
  selectedSong,
  audioRef,
  activeTab,
  isPlaying,
  setIsPlaying,
  duration,
  setDuration,
  currentTime,
  handleTrackedTime,
  rate,
  setRate,
  volume,
  setVolume,
  shuffle,
  setShuffle,
  abLoop,
  markAbLoop,
  togglePlay,
  seekBy,
  seekTo,
  moveSong
}) {
  return (
    <footer className="player">
      <audio
        ref={audioRef}
        src={selectedSong.audioUrl}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => handleTrackedTime(event.currentTarget.currentTime)}
        onEnded={() => setIsPlaying(false)}
      />
      <div className="player-head">
        <strong>{selectedSong.title}</strong>
        <span>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
      <input
        className="seek"
        type="range"
        min="0"
        max={duration || 0}
        step="0.1"
        value={Math.min(currentTime, duration || 0)}
        onChange={(event) => seekTo(event.target.value)}
      />

      <div className="rate-row">
        {rates.map((item) => (
          <button
            key={item}
            className={rate === item ? "rate active" : "rate"}
            onClick={() => setRate(item)}
          >
            {item}x
          </button>
        ))}
      </div>

      <div className="volume-row">
        <Volume2 size={15} />
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          disabled={activeTab === "split"}
          onChange={(event) => setVolume(Number(event.target.value))}
        />
        <span>{Math.round(volume * 100)}%</span>
        <button
          className={shuffle ? "mini-toggle active" : "mini-toggle"}
          onClick={() => setShuffle((current) => !current)}
          title="셔플"
        >
          <Shuffle size={14} />
          셔플
        </button>
        <button
          className={abLoop.start !== null ? "mini-toggle active" : "mini-toggle"}
          onClick={markAbLoop}
          title="A-B 반복"
        >
          <Repeat size={14} />
          {abLoop.start === null ? "A-B" : abLoop.end === null ? "B지점" : "해제"}
        </button>
      </div>

      <div className="transport">
        <button title="이전 곡" onClick={() => moveSong(-1)}>
          <SkipBack size={22} />
        </button>
        <button onClick={() => seekBy(-10)}>-10s</button>
        <button onClick={() => seekBy(-5)}>-5s</button>
        <button onClick={() => seekBy(-3)}>-3s</button>
        <button className="play-button" onClick={togglePlay} title="재생">
          {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
        </button>
        <button onClick={() => seekBy(3)}>+3s</button>
        <button onClick={() => seekBy(5)}>+5s</button>
        <button onClick={() => seekBy(10)}>+10s</button>
        <button title="다음 곡" onClick={() => moveSong(1)}>
          <SkipForward size={22} />
        </button>
      </div>
    </footer>
  );
}

createRoot(document.getElementById("root")).render(<App />);
