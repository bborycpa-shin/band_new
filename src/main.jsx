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
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  UploadCloud,
  Users,
  Volume2,
  X
} from "lucide-react";
import { supabase, supabaseConfig } from "./lib/supabase";
import {
  loadFileManifest,
  manifestFolder,
  moveDisplayName,
  removeDisplayName,
  saveFileManifest,
  setDisplayName,
  setManifestOrder
} from "./lib/fileManifest";
import { loadSupabaseSongs } from "./lib/loadSupabaseSongs";
import { createEmptySplitSong, loadSupabaseSplitSongs } from "./lib/loadSupabaseSplitSongs";
import { loadSupabaseSheets } from "./lib/loadSupabaseSheets";
import { createEmptyAlbum, loadSupabaseAlbums } from "./lib/loadSupabaseAlbums";
import { instruments, sampleSongs } from "./data/songs";
import "./styles.css";

const tabs = [
  { key: "play", label: "재생", icon: ListMusic },
  { key: "split", label: "분할", icon: SlidersHorizontal },
  { key: "score", label: "악보", icon: Download },
  { key: "album", label: "앨범", icon: Image },
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

const emptySong = {
  id: "empty",
  title: "곡을 불러오는 중입니다",
  artist: "",
  audioPath: "",
  audioUrl: "",
  splitTrackPaths: Object.fromEntries(instruments.map((instrument) => [instrument.key, ""])),
  splitTracks: Object.fromEntries(instruments.map((instrument) => [instrument.key, ""])),
  scores: [],
  album: { images: [], youtubeId: "" },
  partsReady: 0
};

function safeFileName(file) {
  const extension = file.name.includes(".") ? `.${file.name.split(".").pop().toLowerCase()}` : "";
  const baseName = file.name.replace(/\.[^.]+$/, "");
  const cleanBase = safeName(baseName);
  return cleanBase === "file" ? `upload${extension}` : `${cleanBase}${extension}`;
}

function uniqueFileName(file) {
  return `${Date.now()}-${crypto.randomUUID()}-${safeFileName(file)}`;
}

const splitFileNameInstrumentMap = [
  { key: "vocal", terms: ["vocal", "vocals", "voice", "보컬"] },
  { key: "guitar", terms: ["guitar", "gt", "기타"] },
  { key: "bass", terms: ["bass", "베이스"] },
  { key: "drums", terms: ["drums", "drum", "드럼"] },
  { key: "keys", terms: ["piano", "keyboard", "keys", "key", "건반", "피아노"] },
  { key: "other", terms: ["other", "others", "etc"] }
];

function detectSplitInstrument(fileName) {
  const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();
  const tokens = baseName.split(/[\s._\-()[\]{}]+/).filter(Boolean);

  for (const item of splitFileNameInstrumentMap) {
    if (item.terms.some((term) => tokens.includes(term))) return item.key;
  }

  return "";
}

function uniqueJpegFileName(file) {
  const baseName = safeName(file.name.replace(/\.[^.]+$/, ""));
  return `${Date.now()}-${crypto.randomUUID()}-${baseName === "file" ? "photo" : baseName}.jpg`;
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("이미지를 읽을 수 없습니다."));
    };
    image.src = objectUrl;
  });
}

async function resizeImageFile(file, { maxSize, quality, name }) {
  if (!file.type.startsWith("image/")) return file;

  const image = await loadImageElement(file);
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) return file;
  return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
}

function newSongFolderName() {
  return `song-${Date.now()}`;
}

function newSplitFolderName() {
  return `split-${Date.now()}`;
}

function newAlbumFolderName() {
  return `album-${Date.now()}`;
}

function App() {
  const [activeTab, setActiveTab] = useState("play");
  const [appSongs, setAppSongs] = useState([]);
  const [libraryStatus, setLibraryStatus] = useState("불러오는 중");
  const [selectedId, setSelectedId] = useState("");
  const [pendingPlayId, setPendingPlayId] = useState("");
  const [splitSongs, setSplitSongs] = useState([]);
  const [splitLibraryStatus, setSplitLibraryStatus] = useState("불러오는 중");
  const [selectedSplitId, setSelectedSplitId] = useState("");
  const [pendingSplitPlayId, setPendingSplitPlayId] = useState("");
  const [sheetFiles, setSheetFiles] = useState([]);
  const [sheetStatus, setSheetStatus] = useState("불러오는 중");
  const [albumFolders, setAlbumFolders] = useState([]);
  const [albumStatus, setAlbumStatus] = useState("불러오는 중");
  const [selectedAlbumId, setSelectedAlbumId] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackMode, setPlaybackMode] = useState("play");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(0.7);
  const [shuffle, setShuffle] = useState(false);
  const [abLoop, setAbLoop] = useState({ start: null, end: null });
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isStandaloneApp, setIsStandaloneApp] = useState(
    () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true
  );
  const [splitVolumes, setSplitVolumes] = useState(() =>
    Object.fromEntries(instruments.map((instrument) => [instrument.key, 0.7]))
  );
  const audioRef = useRef(null);
  const splitRefs = useRef({});

  const selectedSong = useMemo(
    () => appSongs.find((song) => song.id === selectedId) ?? appSongs[0] ?? emptySong,
    [appSongs, selectedId]
  );
  const selectedSplitSong = useMemo(
    () => splitSongs.find((song) => song.id === selectedSplitId) ?? splitSongs[0] ?? createEmptySplitSong(),
    [splitSongs, selectedSplitId]
  );
  const selectedAlbum = useMemo(
    () => albumFolders.find((album) => album.id === selectedAlbumId) ?? albumFolders[0] ?? createEmptyAlbum(),
    [albumFolders, selectedAlbumId]
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

  async function refreshSplitLibrary(nextSelectedId = selectedSplitId) {
    const result = await loadSupabaseSplitSongs();
    setSplitSongs(result.songs);
    setSelectedSplitId(
      result.songs.some((song) => song.id === nextSelectedId)
        ? nextSelectedId
        : result.songs[0]?.id ?? "split-empty"
    );
    if (result.source === "supabase") {
      setSplitLibraryStatus(`분할 ${result.songs.length}곡`);
    } else {
      setSplitLibraryStatus(result.error ? `분할 목록: ${result.error}` : "분할 목록 없음");
    }
  }

  async function refreshSheetLibrary() {
    const result = await loadSupabaseSheets();
    setSheetFiles(result.sheets);
    if (result.source === "supabase") {
      setSheetStatus(`악보 ${result.sheets.length}개`);
    } else {
      setSheetStatus(result.error ? `악보 목록: ${result.error}` : "악보 없음");
    }
  }

  async function refreshAlbumLibrary(nextSelectedId = selectedAlbumId) {
    const result = await loadSupabaseAlbums();
    setAlbumFolders(result.albums);
    setSelectedAlbumId(
      result.albums.some((album) => album.id === nextSelectedId)
        ? nextSelectedId
        : result.albums[0]?.id ?? "album-empty"
    );
    if (result.source === "supabase") {
      setAlbumStatus(`사진 폴더 ${result.albums.length}개`);
    } else {
      setAlbumStatus(result.error ? `사진 목록: ${result.error}` : "사진 폴더 없음");
    }
  }

  useEffect(() => {
    refreshLibrary("");
    refreshSplitLibrary("");
    refreshSheetLibrary();
    refreshAlbumLibrary("");
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(display-mode: standalone)");
    const handleDisplayModeChange = () => {
      setIsStandaloneApp(mediaQuery?.matches || window.navigator.standalone === true);
    };
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsStandaloneApp(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    mediaQuery?.addEventListener?.("change", handleDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      mediaQuery?.removeEventListener?.("change", handleDisplayModeChange);
    };
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
  }, [rate, splitVolumes, selectedSplitSong]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAbLoop({ start: null, end: null });
  }, [selectedId, selectedSplitId]);

  useEffect(() => {
    if (!pendingPlayId || pendingPlayId !== selectedSong.id || !selectedSong.audioUrl) return;
    const audio = audioRef.current;
    if (!audio) return;

    pauseSplitTracks();
    setPlaybackMode("play");
    audio.currentTime = 0;
    audio.play().then(() => setIsPlaying(true)).catch(() => {});
    setPendingPlayId("");
  }, [pendingPlayId, selectedSong]);

  useEffect(() => {
    if (!pendingSplitPlayId || pendingSplitPlayId !== selectedSplitSong.id) return;
    const activeAudios = instruments
      .map((instrument) => splitRefs.current[instrument.key])
      .filter((audio) => audio?.currentSrc || audio?.src);

    if (!activeAudios.length) {
      setPendingSplitPlayId("");
      return;
    }

    pauseMainAudio();
    setPlaybackMode("split");
    activeAudios.forEach((audio) => {
      audio.currentTime = 0;
      audio.playbackRate = rate;
      audio.volume = splitVolumes[audio.dataset.instrument] ?? 0.7;
    });
    Promise.allSettled(activeAudios.map((audio) => audio.play())).then(() => setIsPlaying(true));
    setPendingSplitPlayId("");
  }, [pendingSplitPlayId, selectedSplitSong, rate, splitVolumes]);

  function selectSong(song) {
    setSelectedId(song.id);
    setPendingPlayId(song.id);
    if (song.audioUrl && audioRef.current) {
      pauseSplitTracks();
      setPlaybackMode("play");
      audioRef.current.src = song.audioUrl;
      audioRef.current.currentTime = 0;
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }

  function selectSplitSong(song) {
    setSelectedSplitId(song.id);
  }

  function pauseMainAudio() {
    const audio = audioRef.current;
    if (audio) audio.pause();
  }

  function pauseSplitTracks() {
    instruments.forEach((instrument) => {
      const audio = splitRefs.current[instrument.key];
      if (audio) audio.pause();
    });
  }

  function switchTab(nextTab) {
    setActiveTab(nextTab);
  }

  function currentPlayerMode() {
    return isPlaying ? playbackMode : activeTab;
  }

  async function togglePlay() {
    if (currentPlayerMode() === "split") {
      await toggleSplitPlay();
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      pauseSplitTracks();
      setPlaybackMode("play");
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
      .filter((audio) => audio?.currentSrc || audio?.src);

    if (!activeAudios.length) return;

    if (isPlaying) {
      activeAudios.forEach((audio) => audio.pause());
      setIsPlaying(false);
      return;
    }

    pauseMainAudio();
    setPlaybackMode("split");
    activeAudios.forEach((audio) => {
      audio.currentTime = currentTime;
      audio.playbackRate = rate;
      audio.volume = splitVolumes[audio.dataset.instrument] ?? 0.7;
    });
    await Promise.allSettled(activeAudios.map((audio) => audio.play()));
    setIsPlaying(true);
  }

  async function playSplitSong(song) {
    setSelectedSplitId(song.id);
    setPendingSplitPlayId(song.id);
    setCurrentTime(0);
    setPlaybackMode("split");
    pauseMainAudio();

    const activeAudios = instruments
      .map((instrument) => {
        const audio = splitRefs.current[instrument.key];
        const src = song.splitTracks?.[instrument.key];
        if (!audio || !src) return null;
        audio.src = src;
        audio.currentTime = 0;
        audio.playbackRate = rate;
        audio.volume = splitVolumes[instrument.key] ?? 0.7;
        return audio;
      })
      .filter(Boolean);

    await Promise.allSettled(activeAudios.map((audio) => audio.play()));
    setIsPlaying(Boolean(activeAudios.length));
  }

  function seekBy(seconds) {
    if (currentPlayerMode() === "split") {
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
    if (currentPlayerMode() === "split") {
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
    if (currentPlayerMode() === "split") {
      if (splitSongs.length < 1) return;
      const currentIndex = splitSongs.findIndex((song) => song.id === selectedSplitSong.id);
      const nextIndex = (currentIndex + offset + splitSongs.length) % splitSongs.length;
      setSelectedSplitId(splitSongs[nextIndex].id);
      return;
    }

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

  async function uploadSongFile(song, file) {
    const files = Array.from(file instanceof FileList ? file : file ? [file] : []);
    if (!supabase || !files.length) return;
    const bucket = supabaseConfig.buckets.audio;
    const isNewSong = !song || song.id === "empty";
    const uploaded = [];

    for (const item of files) {
      const folder = isNewSong ? newSongFolderName() : song.id;
      const path = `${folder}/full/${uniqueFileName(item)}`;
      const { error } = await supabase.storage.from(bucket).upload(path, item, {
        cacheControl: "3600",
        upsert: true
      });
      if (error) {
        window.alert(`업로드 실패: ${error.message}`);
        continue;
      }
      await setDisplayName(bucket, path, item.name);
      uploaded.push({ folder, path });
    }

    if (!uploaded.length) return;

    if (isNewSong) {
      await setManifestOrder(bucket, [
        ...uploaded.map((item) => item.path),
        ...appSongs.map((item) => item.audioPath).filter(Boolean)
      ]);
    }
    await refreshLibrary(uploaded[0].folder);
  }

  async function renameSong(song, nextName) {
    if (!supabase || !song.audioPath || !nextName.trim()) return;
    await setDisplayName(supabaseConfig.buckets.audio, song.audioPath, nextName.trim());
    await refreshLibrary(song.id);
  }

  async function deleteSong(song) {
    if (!supabase || !song.audioPath) return;
    const ok = window.confirm(`${song.title} 파일을 삭제할까요?`);
    if (!ok) return;

    const bucket = supabaseConfig.buckets.audio;
    const { error } = await supabase.storage.from(bucket).remove([song.audioPath]);
    if (error) {
      window.alert(`삭제 실패: ${error.message}`);
      return;
    }

    await removeDisplayName(bucket, song.audioPath);
    await setManifestOrder(
      bucket,
      appSongs
        .filter((item) => item.audioPath && item.audioPath !== song.audioPath)
        .map((item) => item.audioPath)
    );
    await refreshLibrary();
  }

  async function reorderSongs(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const previousSongs = appSongs;
    const reordered = [...appSongs];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setAppSongs(reordered);
    try {
      await setManifestOrder(
        supabaseConfig.buckets.audio,
        reordered.map((song) => song.audioPath).filter(Boolean)
      );
    } catch (error) {
      setAppSongs(previousSongs);
      window.alert(`순서 저장 실패: ${error.message}`);
    }
  }

  async function uploadSplitTrack(song, instrumentKey, file) {
    if (!supabase || !file) return;
    if (!song?.id || song.id === "split-empty") {
      window.alert("먼저 분할곡을 추가해주세요.");
      return;
    }
    const bucket = supabaseConfig.buckets.split;
    const path = `${song.id}/${instrumentKey}/${uniqueFileName(file)}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: "3600",
      upsert: true
    });
    if (error) {
      window.alert(`분할 음원 업로드 실패: ${error.message}`);
      return;
    }
    await setDisplayName(bucket, path, file.name);
    const previousPath = song.splitTrackPaths?.[instrumentKey];
    if (previousPath) {
      await supabase.storage.from(bucket).remove([previousPath]);
      await removeDisplayName(bucket, previousPath);
    }
    await refreshSplitLibrary(song.id);
  }

  async function uploadSplitTracks(song, fileList) {
    const files = Array.from(fileList ?? []);
    if (!supabase || !files.length) return;
    if (!song?.id || song.id === "split-empty") {
      window.alert("먼저 분할곡을 추가해주세요.");
      return;
    }

    const matchedFiles = files.map((file) => ({
      file,
      instrumentKey: detectSplitInstrument(file.name)
    }));
    const unmatchedFiles = matchedFiles.filter((item) => !item.instrumentKey);
    const duplicateKeys = matchedFiles
      .map((item) => item.instrumentKey)
      .filter((key, index, keys) => key && keys.indexOf(key) !== index);

    if (unmatchedFiles.length) {
      window.alert(
        `악기 구분을 못 한 파일이 있습니다:\n${unmatchedFiles.map((item) => item.file.name).join("\n")}`
      );
      return;
    }

    if (duplicateKeys.length) {
      const names = [...new Set(duplicateKeys)]
        .map((key) => instruments.find((instrument) => instrument.key === key)?.label ?? key)
        .join(", ");
      window.alert(`같은 악기 파일이 중복 선택됐습니다: ${names}`);
      return;
    }

    const missingInstruments = instruments.filter(
      (instrument) => !matchedFiles.some((item) => item.instrumentKey === instrument.key)
    );
    if (missingInstruments.length) {
      window.alert(`빠진 악기 파일이 있습니다: ${missingInstruments.map((item) => item.label).join(", ")}`);
      return;
    }

    const bucket = supabaseConfig.buckets.split;
    const uploaded = [];

    for (const item of matchedFiles) {
      const path = `${song.id}/${item.instrumentKey}/${uniqueFileName(item.file)}`;
      const { error } = await supabase.storage.from(bucket).upload(path, item.file, {
        cacheControl: "3600",
        upsert: true
      });

      if (error) {
        window.alert(`분할 음원 업로드 실패: ${item.file.name}\n${error.message}`);
        continue;
      }

      await setDisplayName(bucket, path, item.file.name);
      uploaded.push({ ...item, path });
    }

    for (const item of uploaded) {
      const previousPath = song.splitTrackPaths?.[item.instrumentKey];
      if (previousPath) {
        await supabase.storage.from(bucket).remove([previousPath]);
        await removeDisplayName(bucket, previousPath);
      }
    }

    await refreshSplitLibrary(song.id);

    if (uploaded.length) {
      window.alert(`${uploaded.length}개 분할 파일을 업로드했습니다.`);
    }
  }

  async function addSplitSong() {
    if (!supabase) return;
    const title = window.prompt("분할 곡 이름을 입력해주세요");
    if (!title?.trim()) return;

    const bucket = supabaseConfig.buckets.split;
    const folder = newSplitFolderName();
    const manifest = await loadFileManifest(bucket);
    manifest.__splitSongs = {
      ...(manifest.__splitSongs ?? {}),
      [folder]: { title: title.trim() }
    };
    manifest.__splitOrder = [folder, ...(manifest.__splitOrder ?? []).filter((item) => item !== folder)];
    await saveFileManifest(bucket, manifest);
    await refreshSplitLibrary(folder);
  }

  async function deleteSplitTrack(song, instrumentKey) {
    const path = song?.splitTrackPaths?.[instrumentKey];
    if (!supabase || !path) return;

    const ok = window.confirm("이 악기 파일을 삭제할까요?");
    if (!ok) return;

    const bucket = supabaseConfig.buckets.split;
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) {
      window.alert(`삭제 실패: ${error.message}`);
      return;
    }

    await removeDisplayName(bucket, path);
    await refreshSplitLibrary(song.id);
  }

  async function uploadSheetFile(file) {
    const files = Array.from(file instanceof FileList ? file : file ? [file] : []);
    if (!supabase || !files.length) return;

    const bucket = supabaseConfig.buckets.score;
    for (const item of files) {
      const path = uniqueFileName(item);
      const { error } = await supabase.storage.from(bucket).upload(path, item, {
        cacheControl: "3600",
        upsert: true
      });

      if (error) {
        window.alert(`악보 업로드 실패: ${error.message}`);
        continue;
      }

      await setDisplayName(bucket, path, item.name);
    }

    await refreshSheetLibrary();
  }

  async function deleteSheetFile(sheet) {
    if (!supabase || !sheet?.path) return;
    const ok = window.confirm("이 악보 파일을 삭제할까요?");
    if (!ok) return;

    const bucket = supabaseConfig.buckets.score;
    const { error } = await supabase.storage.from(bucket).remove([sheet.path]);
    if (error) {
      window.alert(`악보 삭제 실패: ${error.message}`);
      return;
    }

    await removeDisplayName(bucket, sheet.path);
    await refreshSheetLibrary();
  }

  async function addAlbumFolder() {
    if (!supabase) return;
    const title = window.prompt("사진 폴더 이름을 입력해주세요");
    if (!title?.trim()) return;

    const bucket = supabaseConfig.buckets.album;
    const folder = newAlbumFolderName();
    const manifest = await loadFileManifest(bucket);
    manifest.__albumFolders = {
      ...(manifest.__albumFolders ?? {}),
      [folder]: { title: title.trim() }
    };
    manifest.__albumOrder = [folder, ...(manifest.__albumOrder ?? []).filter((item) => item !== folder)];
    await saveFileManifest(bucket, manifest);
    await refreshAlbumLibrary(folder);
  }

  async function uploadAlbumPhotos(album, fileList) {
    const files = Array.from(fileList ?? []);
    if (!supabase || !files.length) return;
    if (!album?.id || album.id === "album-empty") {
      window.alert("먼저 사진 폴더를 추가해주세요.");
      return;
    }

    const bucket = supabaseConfig.buckets.album;
    for (const file of files) {
      const fileName = uniqueJpegFileName(file);
      const path = `${album.id}/${fileName}`;
      const thumbnailPath = `${album.id}/.thumbs/${fileName}`;
      const displayImage = await resizeImageFile(file, { maxSize: 2200, quality: 0.82, name: fileName });
      const thumbnail = await resizeImageFile(file, { maxSize: 360, quality: 0.72, name: fileName });
      const { error } = await supabase.storage.from(bucket).upload(path, displayImage, {
        cacheControl: "3600",
        contentType: "image/jpeg",
        upsert: true
      });

      if (error) {
        window.alert(`사진 업로드 실패: ${error.message}`);
        continue;
      }

      const { error: thumbnailError } = await supabase.storage.from(bucket).upload(thumbnailPath, thumbnail, {
        cacheControl: "3600",
        contentType: "image/jpeg",
        upsert: true
      });

      if (thumbnailError) {
        window.alert(`썸네일 업로드 실패: ${thumbnailError.message}`);
      }

      await setDisplayName(bucket, path, file.name);
    }

    await refreshAlbumLibrary(album.id);
  }

  async function deleteAlbumPhoto(album, image) {
    if (!supabase || !image?.path) return;
    const ok = window.confirm("이 사진을 삭제할까요?");
    if (!ok) return;

    const bucket = supabaseConfig.buckets.album;
    const removePaths = [image.path, image.thumbnailPath].filter(Boolean);
    const { error } = await supabase.storage.from(bucket).remove(removePaths);
    if (error) {
      window.alert(`사진 삭제 실패: ${error.message}`);
      return;
    }

    await removeDisplayName(bucket, image.path);
    if (image.thumbnailPath) await removeDisplayName(bucket, image.thumbnailPath);
    await refreshAlbumLibrary(album.id);
  }

  async function deleteAlbumFolder(album) {
    if (!supabase || !album?.id || album.id === "album-empty") return;
    const ok = window.confirm(`${album.title} 폴더와 안의 사진을 삭제할까요?`);
    if (!ok) return;

    const bucket = supabaseConfig.buckets.album;
    const paths = album.images.flatMap((image) => [image.path, image.thumbnailPath]).filter(Boolean);
    if (paths.length) {
      const { error } = await supabase.storage.from(bucket).remove(paths);
      if (error) {
        window.alert(`폴더 삭제 실패: ${error.message}`);
        return;
      }
    }

    const manifest = await loadFileManifest(bucket);
    delete manifest.__albumFolders?.[album.id];
    manifest.__albumOrder = (manifest.__albumOrder ?? []).filter((item) => item !== album.id);
    paths.forEach((path) => {
      delete manifest[path];
    });
    await saveFileManifest(bucket, manifest);
    await refreshAlbumLibrary("");
  }

  const playerMode = currentPlayerMode();
  const playerSong = playerMode === "split" ? selectedSplitSong : selectedSong;
  const canInstallApp = Boolean(installPrompt && !isStandaloneApp);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Band Player</p>
          <h1>계단밑딴따라</h1>
        </div>
        {canInstallApp ? (
          <button className="install-app-button" type="button" onClick={installApp}>
            <Download size={16} />
            앱 설치
          </button>
        ) : (
          <button className="icon-button" title="설정">
            <Gauge size={19} />
          </button>
        )}
      </header>

      <nav className="tabbar" aria-label="주요 메뉴">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              className={activeTab === tab.key ? "tab active" : "tab"}
              onClick={() => switchTab(tab.key)}
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
            onUploadSong={uploadSongFile}
            onRenameSong={renameSong}
            onDeleteSong={deleteSong}
            onReorderSongs={reorderSongs}
          />
        )}
        <div className={activeTab === "split" ? "" : "tab-panel-hidden"}>
          <SplitPanel
            songs={splitSongs}
            selectedSong={selectedSplitSong}
            onSelect={selectSplitSong}
            libraryStatus={splitLibraryStatus}
            splitRefs={splitRefs}
            splitVolumes={splitVolumes}
            setSplitVolumes={setSplitVolumes}
            setAllSplitVolumes={setAllSplitVolumes}
            setCurrentTime={handleTrackedTime}
            setDuration={setDuration}
            setIsPlaying={setIsPlaying}
            onAddSplitSong={addSplitSong}
            onPlaySplitSong={playSplitSong}
            onUploadSplitTrack={uploadSplitTrack}
            onUploadSplitTracks={uploadSplitTracks}
            onDeleteSplitTrack={deleteSplitTrack}
          />
        </div>
        {activeTab === "score" && (
          <ScorePanel
            sheets={sheetFiles}
            sheetStatus={sheetStatus}
            onUploadSheet={uploadSheetFile}
            onDeleteSheet={deleteSheetFile}
          />
        )}
        {activeTab === "album" && (
          <AlbumPanel
            albums={albumFolders}
            selectedAlbum={selectedAlbum}
            albumStatus={albumStatus}
            onSelectAlbum={setSelectedAlbumId}
            onAddAlbumFolder={addAlbumFolder}
            onUploadAlbumPhotos={uploadAlbumPhotos}
            onDeleteAlbumFolder={deleteAlbumFolder}
            onDeleteAlbumPhoto={deleteAlbumPhoto}
          />
        )}
        {activeTab === "member" && <MemberPanel />}
      </main>

      <PlayerBar
        selectedSong={playerSong}
        audioRef={audioRef}
        activeTab={playerMode}
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

function PlayList({
  songs,
  selectedSong,
  onSelect,
  libraryStatus,
  onUploadSong,
  onRenameSong,
  onDeleteSong,
  onReorderSongs
}) {
  const selectedIndex = songs.findIndex((song) => song.id === selectedSong.id);

  return (
    <section className="panel">
      <div className="section-title">
        <h2>플레이리스트</h2>
        <div className="section-actions">
          <span>{libraryStatus}</span>
          <div className="playlist-order-actions" aria-label="Selected song order">
            <button
              type="button"
              title="Move selected song up"
              disabled={selectedIndex <= 0}
              onClick={() => onReorderSongs?.(selectedIndex, selectedIndex - 1)}
            >
              <ArrowUp size={15} />
            </button>
            <button
              type="button"
              title="Move selected song down"
              disabled={selectedIndex === -1 || selectedIndex >= songs.length - 1}
              onClick={() => onReorderSongs?.(selectedIndex, selectedIndex + 1)}
            >
              <ArrowDown size={15} />
            </button>
          </div>
          <label className="mini-file-button text-file-button">
            곡 추가
            <input
              type="file"
              accept="audio/*"
              multiple
              onChange={(event) => {
                onUploadSong?.(null, event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      <SongList
        songs={songs}
        selectedSong={selectedSong}
        onSelect={onSelect}
        mode="play"
        editable
        onUploadSong={onUploadSong}
        onRenameSong={onRenameSong}
        onDeleteSong={onDeleteSong}
      />
    </section>
  );
}

function SongList({
  songs,
  selectedSong,
  onSelect,
  mode,
  showMeta = mode === "split",
  editable = false,
  onUploadSong,
  onRenameSong,
  onDeleteSong,
  renderSongAction,
  renderAfterSong
}) {
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");

  if (!songs.length) {
    return <div className="empty-list">곡 목록을 불러오고 있습니다.</div>;
  }

  return (
    <div className="song-list">
      {songs.map((song, index) => {
        const isEditing = editingId === song.id;
        return (
          <React.Fragment key={song.id}>
            <div
              className={[
                "song-row",
                selectedSong.id === song.id ? "selected" : "",
                editable ? "editable" : "",
                renderSongAction ? "with-action" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onSelect(song)}
            >
              <span className="song-number">{index + 1}</span>
              <button
                className="song-main"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(song);
                }}
              >
                {isEditing ? (
                  <input
                    className="song-inline-input"
                    value={editingName}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setEditingName(event.target.value)}
                  />
                ) : (
                  <span className="song-name">{song.title}</span>
                )}
              </button>
              {showMeta && (
                <span className="song-meta">{mode === "split" ? `${song.partsReady}/6` : song.scores.length}</span>
              )}
              {renderSongAction?.(song)}
              {editable && (
                <div className="song-actions" onClick={(event) => event.stopPropagation()}>
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          onRenameSong?.(song, editingName);
                          setEditingId("");
                        }}
                      >
                        저장
                      </button>
                      <button type="button" onClick={() => setEditingId("")}>
                        취소
                      </button>
                    </>
                  ) : (
                    <>
                      <label className="mini-file-button" title="음원 업로드">
                        <UploadCloud size={15} />
                        <input
                          type="file"
                          accept="audio/*"
                          onChange={(event) => {
                            onUploadSong?.(song, event.target.files?.[0]);
                            event.target.value = "";
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        title="이름 변경"
                        onClick={() => {
                          setEditingId(song.id);
                          setEditingName(song.title);
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button type="button" title="삭제" onClick={() => onDeleteSong?.(song)}>
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            {renderAfterSong?.(song)}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function SplitPanel({
  songs,
  selectedSong,
  onSelect,
  libraryStatus,
  splitRefs,
  splitVolumes,
  setSplitVolumes,
  setAllSplitVolumes,
  setCurrentTime,
  setDuration,
  setIsPlaying,
  onAddSplitSong,
  onPlaySplitSong,
  onUploadSplitTrack,
  onUploadSplitTracks,
  onDeleteSplitTrack
}) {
  function renderSplitControls(song) {
    if (song.id !== selectedSong.id) return null;

    return (
      <div className="split-inline-controls">
        <label className="split-bulk-upload-button" title="6개 분할 파일 일괄 업로드">
          <UploadCloud size={16} />
          <span>6개 파일 일괄 업로드</span>
          <input
            type="file"
            accept="audio/*"
            multiple
            onChange={(event) => {
              onUploadSplitTracks?.(song, event.target.files);
              event.target.value = "";
            }}
          />
        </label>

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
              <label className="track-upload-button" title={`${instrument.label} 파일 업로드`}>
                <UploadCloud size={15} />
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(event) => {
                    onUploadSplitTrack?.(song, instrument.key, event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                className="track-delete-button"
                type="button"
                title={`${instrument.label} 파일 삭제`}
                disabled={!song.splitTrackPaths?.[instrument.key]}
                onClick={() => onDeleteSplitTrack?.(song, instrument.key)}
              >
                <Trash2 size={15} />
              </button>
              <audio
                key={song.splitTrackPaths?.[instrument.key] || `${song.id}-${instrument.key}`}
                data-instrument={instrument.key}
                ref={(node) => {
                  if (node) splitRefs.current[instrument.key] = node;
                }}
                src={song.splitTracks[instrument.key]}
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
    );
  }

  return (
    <section className="panel split-panel">
      <div className="section-title">
        <h2>분할 재생</h2>
        <div className="section-actions">
          <span>{libraryStatus}</span>
          <button className="mini-file-button text-file-button" type="button" onClick={onAddSplitSong}>
            분할곡 추가
          </button>
        </div>
      </div>
      <SongList
        songs={songs}
        selectedSong={selectedSong}
        onSelect={onSelect}
        mode="split"
        renderSongAction={(song) => (
          <button
            className="split-row-play-button"
            type="button"
            title="분할 전체 재생"
            disabled={!song.partsReady}
            onClick={(event) => {
              event.stopPropagation();
              onPlaySplitSong?.(song);
            }}
          >
            <Play size={14} fill="currentColor" />
          </button>
        )}
        renderAfterSong={renderSplitControls}
      />
    </section>
  );
}

function ScorePanel({ sheets, sheetStatus, onUploadSheet, onDeleteSheet }) {
  return (
    <section className="panel">
      <div className="section-title">
        <h2>악보</h2>
        <div className="section-actions">
          <span>{sheetStatus}</span>
          <label className="mini-file-button text-file-button">
            악보 추가
            <input
              type="file"
              accept=".pdf,image/*"
              multiple
              onChange={(event) => {
                onUploadSheet?.(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      <div className="score-list standalone-score-list">
        {sheets.length ? (
          sheets.map((score) => (
            <div className="score-row" key={score.path}>
              <a href={score.url} download>
                <span>{score.label}</span>
                <Download size={16} />
              </a>
              <button type="button" title="악보 삭제" onClick={() => onDeleteSheet?.(score)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))
        ) : (
          <div className="empty-list">등록된 악보가 없습니다.</div>
        )}
      </div>
    </section>
  );
}

function AlbumPanel({
  albums,
  selectedAlbum,
  albumStatus,
  onSelectAlbum,
  onAddAlbumFolder,
  onUploadAlbumPhotos,
  onDeleteAlbumFolder,
  onDeleteAlbumPhoto
}) {
  const [viewerIndex, setViewerIndex] = useState(null);
  const activeImage = viewerIndex === null ? null : selectedAlbum.images[viewerIndex];

  useEffect(() => {
    setViewerIndex(null);
  }, [selectedAlbum.id]);

  function moveViewer(offset) {
    if (!selectedAlbum.images.length) return;
    setViewerIndex((current) => {
      const index = current ?? 0;
      return (index + offset + selectedAlbum.images.length) % selectedAlbum.images.length;
    });
  }

  return (
    <section className="split-layout">
      <div className="panel compact">
        <div className="section-title">
          <h2>앨범</h2>
          <div className="section-actions">
            <span>{albumStatus}</span>
            <button className="mini-file-button text-file-button" type="button" onClick={onAddAlbumFolder}>
              폴더 추가
            </button>
          </div>
        </div>
        <div className="song-list">
          {albums.map((album, index) => (
            <div
              key={album.id}
              className={selectedAlbum.id === album.id ? "song-row selected" : "song-row"}
              onClick={() => onSelectAlbum(album.id)}
            >
              <span className="song-number">{index + 1}</span>
              <button
                className="song-main"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectAlbum(album.id);
                }}
              >
                <span className="song-name">{album.title}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="panel album-panel">
        <div className="section-title">
          <h2>{selectedAlbum.title}</h2>
          <div className="section-actions">
            <label className="mini-file-button text-file-button">
              사진 추가
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => {
                  onUploadAlbumPhotos?.(selectedAlbum, event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
            <button
              className="mini-file-button"
              type="button"
              title="폴더 삭제"
              disabled={selectedAlbum.id === "album-empty"}
              onClick={() => {
                setViewerIndex(null);
                onDeleteAlbumFolder?.(selectedAlbum);
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
        {selectedAlbum.images.length ? (
          <div className="photo-grid">
            {selectedAlbum.images.map((image, index) => (
              <div className="photo-thumb" key={image.path}>
                <button type="button" onClick={() => setViewerIndex(index)}>
                  <img src={image.thumbnailUrl || image.url} alt={image.label} loading="lazy" />
                </button>
                <div className="photo-thumb-caption">
                  <span>{image.label}</span>
                  <button
                    type="button"
                    title="사진 삭제"
                    onClick={() => {
                      setViewerIndex(null);
                      onDeleteAlbumPhoto?.(selectedAlbum, image);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-list">등록된 사진이 없습니다.</div>
        )}
      </div>
      {activeImage && (
        <div className="photo-viewer" role="dialog" aria-modal="true">
          <button className="viewer-close" type="button" title="닫기" onClick={() => setViewerIndex(null)}>
            <X size={22} />
          </button>
          <button className="viewer-nav prev" type="button" title="이전 사진" onClick={() => moveViewer(-1)}>
            <ChevronLeft size={34} />
          </button>
          <img src={activeImage.url} alt={activeImage.label} />
          <button className="viewer-nav next" type="button" title="다음 사진" onClick={() => moveViewer(1)}>
            <ChevronRight size={34} />
          </button>
          <div className="viewer-caption">
            <span>{activeImage.label}</span>
            <strong>
              {(viewerIndex ?? 0) + 1} / {selectedAlbum.images.length}
            </strong>
          </div>
        </div>
      )}
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
    <footer className={activeTab === "split" ? "player split-player" : "player play-player"}>
      <audio
        ref={audioRef}
        src={selectedSong.audioUrl}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => handleTrackedTime(event.currentTarget.currentTime)}
        onEnded={() => setIsPlaying(false)}
      />
      <div className="player-head">
        <div className="player-title">
          <strong>{selectedSong.title}</strong>
          {activeTab === "split" && <span className="mode-badge">분할재생중</span>}
        </div>
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
        <button
          className={isPlaying ? "play-button playing" : "play-button paused"}
          onClick={togglePlay}
          title={isPlaying ? "일시정지" : "재생"}
        >
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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
