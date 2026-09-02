import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Download,
  FileText,
  Image,
  ListMusic,
  Lock,
  Mic,
  Music2,
  Pause,
  Pencil,
  Play,
  Repeat,
  Save,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Square,
  Trash2,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  UploadCloud,
  Unlock,
  Volume2,
  VolumeX,
  X,
  Drum
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
  { key: "member", label: "건반", icon: Music2 },
  { key: "drum", label: "드럼", icon: Drum }
];

const rates = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5, 2];
const playSequenceModes = ["list-once", "list-repeat", "song-once", "song-repeat"];
const playSequenceLabels = {
  "list-once": "\uc804\uace1",
  "list-repeat": "\uc804\uace1\u21bb",
  "song-once": "1\uace1",
  "song-repeat": "1\uace1\u21bb"
};
const adminPasswordHashKey = "band-admin-password-hash";
const albumAccessKeyPrefix = "band-album-access-unlocked:";
const defaultAlbumQuestion = "2026년 여름공연시 베이스기타 멤버이름은?(Hint:손**)";
const defaultAlbumAnswer = "손상이";
const albumPageSize = 20;
const libraryCacheKeys = {
  songs: "band-cache:songs:v1",
  splitSongs: "band-cache:split-songs:v1",
  sheets: "band-cache:sheets:v1",
  albums: "band-cache:albums:v1"
};

function readCachedItems(key) {
  try {
    const cached = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(cached?.items) ? cached.items : [];
  } catch {
    return [];
  }
}

function writeCachedItems(key, items) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), items: Array.isArray(items) ? items : [] }));
  } catch {
    // Cache is only a startup speed boost, so storage failures can be ignored.
  }
}

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatKeyShift(value) {
  if (value === 0) return "원음";
  return value > 0 ? `+${value}키` : `${value}키`;
}

function applyPlaybackSettings(audio, rate, keyShift) {
  if (!audio) return;
  const keyFactor = 2 ** (keyShift / 12);
  audio.playbackRate = rate * keyFactor;
  const preservePitch = keyShift === 0;
  audio.preservesPitch = preservePitch;
  audio.mozPreservesPitch = preservePitch;
  audio.webkitPreservesPitch = preservePitch;
}

function shouldIgnoreKeyboardShortcut(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [role='slider'], [role='textbox']"
    )
  );
}

async function hashText(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
  lyrics: "",
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
  const [appSongs, setAppSongs] = useState(() => readCachedItems(libraryCacheKeys.songs));
  const [libraryStatus, setLibraryStatus] = useState(() => {
    const cachedCount = readCachedItems(libraryCacheKeys.songs).length;
    return cachedCount ? `음원 ${cachedCount}곡` : "불러오는 중";
  });
  const [selectedId, setSelectedId] = useState("");
  const [pendingPlayId, setPendingPlayId] = useState("");
  const [splitSongs, setSplitSongs] = useState(() => readCachedItems(libraryCacheKeys.splitSongs));
  const [splitLibraryStatus, setSplitLibraryStatus] = useState(() => {
    const cachedCount = readCachedItems(libraryCacheKeys.splitSongs).length;
    return cachedCount ? `분할 ${cachedCount}곡` : "불러오는 중";
  });
  const [selectedSplitId, setSelectedSplitId] = useState("");
  const [pendingSplitPlayId, setPendingSplitPlayId] = useState("");
  const [sheetFiles, setSheetFiles] = useState(() => readCachedItems(libraryCacheKeys.sheets));
  const [sheetStatus, setSheetStatus] = useState(() => {
    const cachedCount = readCachedItems(libraryCacheKeys.sheets).length;
    return cachedCount ? `악보 ${cachedCount}개` : "불러오는 중";
  });
  const [sheetOrder, setSheetOrder] = useState([]);
  const [albumFolders, setAlbumFolders] = useState(() => readCachedItems(libraryCacheKeys.albums));
  const [albumStatus, setAlbumStatus] = useState(() => {
    const cachedCount = readCachedItems(libraryCacheKeys.albums).length;
    return cachedCount ? `사진 폴더 ${cachedCount}개` : "불러오는 중";
  });
  const [selectedAlbumId, setSelectedAlbumId] = useState("");
  const [lyricsSongId, setLyricsSongId] = useState("");
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [unlockedAlbumIds, setUnlockedAlbumIds] = useState(() => new Set());
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackMode, setPlaybackMode] = useState("play");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [keyShift, setKeyShift] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [playSequenceMode, setPlaySequenceMode] = useState("list-once");
  const [abLoop, setAbLoop] = useState({ start: null, end: null });
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isStandaloneApp, setIsStandaloneApp] = useState(
    () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true
  );
  const [splitVolumes, setSplitVolumes] = useState(() =>
    Object.fromEntries(instruments.map((instrument) => [instrument.key, 0.7]))
  );
  const [splitMuted, setSplitMuted] = useState(() =>
    Object.fromEntries(instruments.map((instrument) => [instrument.key, false]))
  );
  const audioRef = useRef(null);
  const splitRefs = useRef({});
  const previousSplitVolumesRef = useRef(
    Object.fromEntries(instruments.map((instrument) => [instrument.key, 0.7]))
  );

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
      writeCachedItems(libraryCacheKeys.songs, result.songs);
      setLibraryStatus(`음원 ${result.songs.length}곡`);
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
      writeCachedItems(libraryCacheKeys.splitSongs, result.songs);
      setSplitLibraryStatus(`분할 ${result.songs.length}곡`);
    } else {
      setSplitLibraryStatus(result.error ? `분할 목록: ${result.error}` : "분할 목록 없음");
    }
  }

  async function refreshSheetLibrary() {
    const result = await loadSupabaseSheets();
    setSheetFiles(result.sheets);
    setSheetOrder(result.order ?? []);
    if (result.source === "supabase") {
      writeCachedItems(libraryCacheKeys.sheets, result.sheets);
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
      writeCachedItems(libraryCacheKeys.albums, result.albums);
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
    applyPlaybackSettings(audio, rate, keyShift);
    audio.volume = volume;
  }, [rate, keyShift, volume]);

  useEffect(() => {
    instruments.forEach((instrument) => {
      const audio = splitRefs.current[instrument.key];
      if (!audio) return;
      applyPlaybackSettings(audio, rate, keyShift);
      audio.volume = splitMuted[instrument.key] ? 0 : splitVolumes[instrument.key];
    });
  }, [rate, keyShift, splitVolumes, splitMuted, selectedSplitSong]);

  useEffect(() => {
    if (activeTab === "split" && playbackMode !== "play") return;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAbLoop({ start: null, end: null });
    setKeyShift(0);
  }, [selectedId]);

  useEffect(() => {
    if (activeTab !== "split" && playbackMode !== "split") return;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAbLoop({ start: null, end: null });
    setKeyShift(0);
  }, [selectedSplitId]);

  useEffect(() => {
    if (!pendingPlayId || pendingPlayId !== selectedSong.id || !selectedSong.audioUrl) return;
    const audio = audioRef.current;
    if (!audio) return;

    pauseSplitTracks();
    setPlaybackMode("play");
    audio.currentTime = 0;
    applyPlaybackSettings(audio, rate, 0);
    audio.play().then(() => setIsPlaying(true)).catch(() => {});
    setPendingPlayId("");
  }, [pendingPlayId, selectedSong, rate]);

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
      applyPlaybackSettings(audio, rate, 0);
      audio.volume = splitMuted[audio.dataset.instrument] ? 0 : splitVolumes[audio.dataset.instrument] ?? 0.7;
    });
    Promise.allSettled(activeAudios.map((audio) => audio.play())).then(() => setIsPlaying(true));
    setPendingSplitPlayId("");
  }, [pendingSplitPlayId, selectedSplitSong, rate, splitVolumes, splitMuted]);

  function selectSong(song) {
    setSelectedId(song.id);
    setKeyShift(0);
    setPendingPlayId(song.id);
    if (song.audioUrl && audioRef.current) {
      pauseSplitTracks();
      setPlaybackMode("play");
      audioRef.current.src = song.audioUrl;
      audioRef.current.currentTime = 0;
      applyPlaybackSettings(audioRef.current, rate, 0);
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }

  function selectSplitSong(song) {
    setSelectedSplitId(song.id);
    setKeyShift(0);
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
    if (isPlaying) return;

    if (nextTab === "split") {
      const vocalAudio = splitRefs.current.vocal;
      setPlaybackMode("split");
      setCurrentTime(vocalAudio?.currentTime || 0);
      setDuration(Number.isFinite(vocalAudio?.duration) ? vocalAudio.duration : 0);
      return;
    }

    const audio = audioRef.current;
    setPlaybackMode("play");
    setCurrentTime(audio?.currentTime || 0);
    setDuration(Number.isFinite(audio?.duration) ? audio.duration : 0);
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
      applyPlaybackSettings(audio, rate, keyShift);
      audio.volume = splitMuted[audio.dataset.instrument] ? 0 : splitVolumes[audio.dataset.instrument] ?? 0.7;
    });
    await Promise.allSettled(activeAudios.map((audio) => audio.play()));
    setIsPlaying(true);
  }

  useEffect(() => {
    const handleKeyboardShortcut = (event) => {
      const isSpace = event.code === "Space" || event.key === " ";
      const isSeekBack = event.code === "ArrowLeft" || event.key === "ArrowLeft";
      const isSeekForward = event.code === "ArrowRight" || event.key === "ArrowRight";
      if (!isSpace && !isSeekBack && !isSeekForward) return;
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      if (shouldIgnoreKeyboardShortcut(event.target)) return;

      event.preventDefault();

      if (isSpace) {
        togglePlay().catch(() => {});
        return;
      }

      seekBy(isSeekBack ? -5 : 5);
    };

    window.addEventListener("keydown", handleKeyboardShortcut);
    return () => window.removeEventListener("keydown", handleKeyboardShortcut);
  });

  async function playSplitSong(song) {
    setSelectedSplitId(song.id);
    setKeyShift(0);
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
        applyPlaybackSettings(audio, rate, 0);
        audio.volume = splitMuted[instrument.key] ? 0 : splitVolumes[instrument.key] ?? 0.7;
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

    const currentIndex = appSongs.findIndex((song) => song.id === selectedSong.id);
    const nextIndex = (currentIndex + offset + appSongs.length) % appSongs.length;
    setSelectedId(appSongs[nextIndex].id);
  }

  function cyclePlaySequenceMode() {
    setPlaySequenceMode((current) => {
      const currentIndex = playSequenceModes.indexOf(current);
      return playSequenceModes[(currentIndex + 1) % playSequenceModes.length];
    });
  }

  async function restartCurrent() {
    if (currentPlayerMode() === "split") {
      const activeAudios = instruments
        .map((instrument) => splitRefs.current[instrument.key])
        .filter((audio) => audio?.currentSrc || audio?.src);

      if (!activeAudios.length) return;

      pauseMainAudio();
      setPlaybackMode("split");
      activeAudios.forEach((audio) => {
        audio.currentTime = 0;
        applyPlaybackSettings(audio, rate, keyShift);
        audio.volume = splitMuted[audio.dataset.instrument] ? 0 : splitVolumes[audio.dataset.instrument] ?? 0.7;
      });
      setCurrentTime(0);
      await Promise.allSettled(activeAudios.map((audio) => audio.play()));
      setIsPlaying(true);
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    pauseSplitTracks();
    setPlaybackMode("play");
    audio.currentTime = 0;
    applyPlaybackSettings(audio, rate, keyShift);
    await audio.play().catch(() => {});
    setIsPlaying(true);
  }

  function handleMainAudioEnded() {
    if (playSequenceMode === "song-repeat") {
      restartCurrent();
      return;
    }

    const currentIndex = appSongs.findIndex((song) => song.id === selectedSong.id);
    const hasNextSong = currentIndex >= 0 && currentIndex < appSongs.length - 1;

    if (playSequenceMode === "list-once" && hasNextSong) {
      const nextSong = appSongs[currentIndex + 1];
      setSelectedId(nextSong.id);
      setPendingPlayId(nextSong.id);
      return;
    }

    if (playSequenceMode === "list-repeat" && appSongs.length) {
      const nextSong = appSongs[hasNextSong ? currentIndex + 1 : 0];
      setSelectedId(nextSong.id);
      setPendingPlayId(nextSong.id);
      return;
    }

    setIsPlaying(false);
  }

  function handleSplitAudioEnded(instrumentKey) {
    if (instrumentKey !== "vocal") return;

    if (playSequenceMode === "song-repeat") {
      restartCurrent();
      return;
    }

    const currentIndex = splitSongs.findIndex((song) => song.id === selectedSplitSong.id);
    const hasNextSong = currentIndex >= 0 && currentIndex < splitSongs.length - 1;

    if (playSequenceMode === "list-once" && hasNextSong) {
      const nextSong = splitSongs[currentIndex + 1];
      setSelectedSplitId(nextSong.id);
      setPendingSplitPlayId(nextSong.id);
      return;
    }

    if (playSequenceMode === "list-repeat" && splitSongs.length) {
      const nextSong = splitSongs[hasNextSong ? currentIndex + 1 : 0];
      setSelectedSplitId(nextSong.id);
      setPendingSplitPlayId(nextSong.id);
      return;
    }

    setIsPlaying(false);
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

  function setSplitInstrumentVolume(instrumentKey, value) {
    if (value > 0) previousSplitVolumesRef.current[instrumentKey] = value;
    setSplitMuted((current) => ({
      ...current,
      [instrumentKey]: false
    }));
    setSplitVolumes((current) => ({
      ...current,
      [instrumentKey]: value
    }));
  }

  function toggleSplitVolumeZero(instrumentKey) {
    setSplitMuted((current) => ({
      ...current,
      [instrumentKey]: false
    }));
    setSplitVolumes((current) => {
      const currentValue = current[instrumentKey] ?? 0.7;
      if (currentValue > 0) {
        previousSplitVolumesRef.current[instrumentKey] = currentValue;
        return {
          ...current,
          [instrumentKey]: 0
        };
      }

      return {
        ...current,
        [instrumentKey]: previousSplitVolumesRef.current[instrumentKey] || 0.7
      };
    });
  }

  function setAllSplitVolumes(value) {
    if (value > 0) {
      previousSplitVolumesRef.current = Object.fromEntries(
        instruments.map((instrument) => [instrument.key, value])
      );
    }
    setSplitMuted(Object.fromEntries(instruments.map((instrument) => [instrument.key, false])));
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

  async function saveSongLyrics(song, lyrics) {
    if (!supabase || !song.audioPath) return;
    const bucket = supabaseConfig.buckets.audio;
    const manifest = await loadFileManifest(bucket);
    manifest[song.audioPath] = {
      ...(manifest[song.audioPath] ?? {}),
      lyrics
    };
    await saveFileManifest(bucket, manifest);
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

  async function reorderSplitSongs(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const previousSongs = splitSongs;
    const reordered = [...splitSongs];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setSplitSongs(reordered);
    setSelectedSplitId(moved.id);
    try {
      const bucket = supabaseConfig.buckets.split;
      const manifest = await loadFileManifest(bucket);
      manifest.__splitOrder = reordered
        .map((song) => song.id)
        .filter((id) => id && id !== "split-empty");
      await saveFileManifest(bucket, manifest);
    } catch (error) {
      setSplitSongs(previousSongs);
      window.alert(`순서 저장 실패: ${error.message}`);
    }
  }

  async function reorderScoreRows(rowIds, fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const previousOrder = sheetOrder;
    const reordered = [...rowIds];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setSheetOrder(reordered);
    try {
      const bucket = supabaseConfig.buckets.score;
      const manifest = await loadFileManifest(bucket);
      manifest.__scoreOrder = reordered.filter(Boolean);
      await saveFileManifest(bucket, manifest);
    } catch (error) {
      setSheetOrder(previousOrder);
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

  async function renameSplitSong(song) {
    if (!supabase || !song?.id || song.id === "split-empty") return;
    const title = window.prompt("분할 곡 이름을 입력해주세요.", song.title);
    if (!title?.trim()) return;

    const bucket = supabaseConfig.buckets.split;
    const manifest = await loadFileManifest(bucket);
    manifest.__splitSongs = {
      ...(manifest.__splitSongs ?? {}),
      [song.id]: {
        ...(manifest.__splitSongs?.[song.id] ?? {}),
        title: title.trim()
      }
    };
    await saveFileManifest(bucket, manifest);
    await refreshSplitLibrary(song.id);
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

  async function deleteSplitSong(song) {
    if (!supabase || !song?.id || song.id === "split-empty") return;
    const ok = window.confirm(`${song.title} 분할곡과 등록된 악기 파일을 모두 삭제할까요?`);
    if (!ok) return;

    pauseSplitTracks();
    setIsPlaying(false);

    const bucket = supabaseConfig.buckets.split;
    const paths = Object.values(song.splitTrackPaths ?? {}).filter(Boolean);
    if (paths.length) {
      const { error } = await supabase.storage.from(bucket).remove(paths);
      if (error) {
        window.alert(`분할곡 삭제 실패: ${error.message}`);
        return;
      }
    }

    const manifest = await loadFileManifest(bucket);
    delete manifest.__splitSongs?.[song.id];
    manifest.__splitOrder = (manifest.__splitOrder ?? []).filter((item) => item !== song.id);
    paths.forEach((path) => {
      delete manifest[path];
    });
    await saveFileManifest(bucket, manifest);
    await refreshSplitLibrary("");
  }

  async function uploadSheetFile(song, file) {
    const files = Array.from(file instanceof FileList ? file : file ? [file] : []);
    if (!supabase || !files.length) return;

    const bucket = supabaseConfig.buckets.score;
    for (const item of files) {
      const folder = song?.id && song.id !== "empty" ? song.id : "common";
      const path = `${folder}/${uniqueFileName(item)}`;
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

  async function renameAlbumFolder(album) {
    if (!supabase || !album?.id || album.id === "album-empty") return;
    const title = window.prompt("앨범 폴더 이름을 입력해주세요.", album.title);
    if (!title?.trim()) return;

    const bucket = supabaseConfig.buckets.album;
    const manifest = await loadFileManifest(bucket);
    manifest.__albumFolders = {
      ...(manifest.__albumFolders ?? {}),
      [album.id]: {
        ...(manifest.__albumFolders?.[album.id] ?? {}),
        title: title.trim()
      }
    };
    await saveFileManifest(bucket, manifest);
    await refreshAlbumLibrary(album.id);
  }

  async function updateAlbumAccess(album) {
    if (!supabase || !album?.id || album.id === "album-empty") return;
    const question = window.prompt("앨범 열람 질문을 입력해주세요.", album.question || defaultAlbumQuestion);
    if (question === null) return;
    const answer = window.prompt("앨범 열람 정답을 입력해주세요.", album.answer || defaultAlbumAnswer);
    if (answer === null) return;

    const bucket = supabaseConfig.buckets.album;
    const manifest = await loadFileManifest(bucket);
    manifest.__albumFolders = {
      ...(manifest.__albumFolders ?? {}),
      [album.id]: {
        ...(manifest.__albumFolders?.[album.id] ?? {}),
        title: album.title,
        question: question.trim(),
        answer: answer.trim()
      }
    };
    await saveFileManifest(bucket, manifest);
    await refreshAlbumLibrary(album.id);
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
      const displayImage = await resizeImageFile(file, { maxSize: 1200, quality: 0.75, name: fileName });
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
    const ok = window.confirm(`${album.title} 앨범의 사진을 모두 삭제할까요? 폴더는 유지됩니다.`);
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
    paths.forEach((path) => {
      delete manifest[path];
    });
    await saveFileManifest(bucket, manifest);
    await refreshAlbumLibrary(album.id);
  }

  const playerMode = currentPlayerMode();
  const playerSong = playerMode === "split" ? selectedSplitSong : selectedSong;
  const lyricsSong = appSongs.find((song) => song.id === lyricsSongId);
  const canInstallApp = Boolean(installPrompt && !isStandaloneApp);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
  }

  async function toggleAdminMode() {
    if (isAdminMode) {
      setIsAdminMode(false);
      return;
    }

    const savedHash = localStorage.getItem(adminPasswordHashKey);
    if (!savedHash) {
      const newPassword = window.prompt("\uad00\ub9ac\uc790 \ube44\ubc00\ubc88\ud638\ub97c \ucc98\uc74c \uc124\uc815\ud558\uc138\uc694.");
      if (!newPassword) return;
      localStorage.setItem(adminPasswordHashKey, await hashText(newPassword));
      setIsAdminMode(true);
      return;
    }

    const password = window.prompt("\uad00\ub9ac\uc790 \ube44\ubc00\ubc88\ud638\ub97c \uc785\ub825\ud558\uc138\uc694.");
    if (password === null) return;
    if ((await hashText(password)) === savedHash) {
      setIsAdminMode(true);
      return;
    }

    window.alert("\ube44\ubc00\ubc88\ud638\uac00 \ud2c0\ub838\uc2b5\ub2c8\ub2e4.");
  }

  function unlockAlbumAccess(album) {
    if (!album?.id || album.id === "album-empty") return;
    const question = album.question || defaultAlbumQuestion;
    const expectedAnswer = album.answer || defaultAlbumAnswer;
    const answer = window.prompt(question);
    if (answer === null) return;
    if (answer.trim() === expectedAnswer) {
      localStorage.setItem(`${albumAccessKeyPrefix}${album.id}`, todayKey());
      setUnlockedAlbumIds((current) => new Set([...current, album.id]));
      return;
    }

    window.alert("정답이 아닙니다.");
  }

  return (
    <div className={isAdminMode ? "app-shell admin-mode" : "app-shell"}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Band Player</p>
          <h1>계단밑딴따라</h1>
        </div>
        <div className="topbar-actions">
          <button
            className={isAdminMode ? "lock-button active" : "lock-button"}
            type="button"
            title={isAdminMode ? "관리자모드 종료" : "관리자모드 진입"}
            onClick={toggleAdminMode}
          >
            {isAdminMode ? <Unlock size={18} /> : <Lock size={18} />}
          </button>
          {canInstallApp && (
            <button className="install-app-button" type="button" onClick={installApp}>
              <Download size={16} />
              앱 설치
            </button>
          )}
        </div>
      </header>

      <div className="recorder-strip">
        <RecorderPanel
          audioRef={audioRef}
          splitRefs={splitRefs}
          playbackMode={playbackMode}
          selectedSong={playerSong}
        />
      </div>

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
            isAdmin={isAdminMode}
            onUploadSong={uploadSongFile}
            onRenameSong={renameSong}
            onDeleteSong={deleteSong}
            onReorderSongs={reorderSongs}
            onOpenLyrics={(song) => setLyricsSongId(song.id)}
          />
        )}
        <div className={activeTab === "split" ? "" : "tab-panel-hidden"}>
          <SplitPanel
            songs={splitSongs}
            selectedSong={selectedSplitSong}
            onSelect={selectSplitSong}
            libraryStatus={splitLibraryStatus}
            isAdmin={isAdminMode}
            splitRefs={splitRefs}
            isPlayerActive={playerMode === "split"}
            splitVolumes={splitVolumes}
            splitMuted={splitMuted}
            setSplitInstrumentVolume={setSplitInstrumentVolume}
            onToggleSplitVolumeZero={toggleSplitVolumeZero}
            setAllSplitVolumes={setAllSplitVolumes}
            setCurrentTime={handleTrackedTime}
            setDuration={setDuration}
            setIsPlaying={setIsPlaying}
            onSplitAudioEnded={handleSplitAudioEnded}
            onAddSplitSong={addSplitSong}
            onPlaySplitSong={playSplitSong}
            onRenameSplitSong={renameSplitSong}
            onUploadSplitTrack={uploadSplitTrack}
            onUploadSplitTracks={uploadSplitTracks}
            onDeleteSplitTrack={deleteSplitTrack}
            onDeleteSplitSong={deleteSplitSong}
            onReorderSplitSongs={reorderSplitSongs}
          />
        </div>
        {activeTab === "score" && (
          <ScorePanel
            sheets={sheetFiles}
            songs={appSongs}
            scoreOrder={sheetOrder}
            sheetStatus={sheetStatus}
            isAdmin={isAdminMode}
            onUploadSheet={uploadSheetFile}
            onDeleteSheet={deleteSheetFile}
            onReorderScoreRows={reorderScoreRows}
          />
        )}
        {activeTab === "album" && (
          <AlbumPanel
            albums={albumFolders}
            selectedAlbum={selectedAlbum}
            albumStatus={albumStatus}
            isAdmin={isAdminMode}
            unlockedAlbumIds={unlockedAlbumIds}
            onSelectAlbum={setSelectedAlbumId}
            onUnlockAlbum={unlockAlbumAccess}
            onAddAlbumFolder={addAlbumFolder}
            onRenameAlbumFolder={renameAlbumFolder}
            onUpdateAlbumAccess={updateAlbumAccess}
            onUploadAlbumPhotos={uploadAlbumPhotos}
            onDeleteAlbumFolder={deleteAlbumFolder}
            onDeleteAlbumPhoto={deleteAlbumPhoto}
          />
        )}
        {activeTab === "member" && <KeyboardPanel />}
        {activeTab === "drum" && <DrumPanel />}
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
        keyShift={keyShift}
        setKeyShift={setKeyShift}
        volume={volume}
        setVolume={setVolume}
        abLoop={abLoop}
        markAbLoop={markAbLoop}
        togglePlay={togglePlay}
        seekBy={seekBy}
        seekTo={seekTo}
        moveSong={moveSong}
        restartCurrent={restartCurrent}
        playSequenceMode={playSequenceMode}
        cyclePlaySequenceMode={cyclePlaySequenceMode}
        onEnded={handleMainAudioEnded}
      />
      {lyricsSong && (
        <LyricsWindow
          song={lyricsSong}
          isAdmin={isAdminMode}
          onClose={() => setLyricsSongId("")}
          onSave={saveSongLyrics}
        />
      )}
    </div>
  );
}

function RecorderPanel({ audioRef, splitRefs, playbackMode, selectedSong }) {
  const [recordingState, setRecordingState] = useState("idle");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewName, setPreviewName] = useState("");
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const previewAudioRef = useRef(null);
  const previewUrlRef = useRef("");
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const sourceNodesRef = useRef(new WeakMap());
  const outputConnectedRef = useRef(new WeakSet());
  const activeConnectionsRef = useRef([]);
  const micStreamRef = useRef(null);
  const micSourceRef = useRef(null);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  useEffect(() => {
    if (recordingState !== "recording") return undefined;

    setRecordingSeconds(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);

    return () => window.clearInterval(timer);
  }, [recordingState]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      stopMicrophone();
      activeConnectionsRef.current.forEach(({ source, destination }) => {
        try {
          source.disconnect(destination);
        } catch {
          // Already disconnected.
        }
      });
      audioContextRef.current?.close?.().catch(() => {});
    };
  }, []);

  function stopMicrophone() {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    try {
      micSourceRef.current?.disconnect();
    } catch {
      // Already disconnected.
    }
    micSourceRef.current = null;
  }

  function currentAudioElements() {
    if (playbackMode === "split") {
      return instruments
        .map((instrument) => splitRefs.current[instrument.key])
        .filter((audio) => audio?.src && !audio.paused);
    }

    const audio = audioRef.current;
    return audio?.src && !audio.paused ? [audio] : [];
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      window.alert("\uc774 \ube0c\ub77c\uc6b0\uc800\uc5d0\uc11c\ub294 \ub179\uc74c\uc744 \uc0ac\uc6a9\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.");
      return;
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass();
      }
      const context = audioContextRef.current;
      await context.resume();

      const destination = context.createMediaStreamDestination();
      const activeAudioElements = currentAudioElements();
      const activeConnections = [];

      activeAudioElements.forEach((element) => {
        let source = sourceNodesRef.current.get(element);
        if (!source) {
          source = context.createMediaElementSource(element);
          sourceNodesRef.current.set(element, source);
        }
        if (!outputConnectedRef.current.has(source)) {
          source.connect(context.destination);
          outputConnectedRef.current.add(source);
        }
        source.connect(destination);
        activeConnections.push({ source, destination });
      });

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      const micSource = context.createMediaStreamSource(micStream);
      micSource.connect(destination);

      micStreamRef.current = micStream;
      micSourceRef.current = micSource;
      activeConnectionsRef.current = activeConnections;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mediaRecorder = new MediaRecorder(destination.stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        setPreviewUrl(url);
        setPreviewName(`${selectedSong?.title || "recording"}-${timestamp}.webm`);
        setPreviewTime(0);
        setPreviewDuration(0);
        setRecordingState("idle");
        stopMicrophone();
        activeConnectionsRef.current.forEach(({ source, destination: connectedDestination }) => {
          try {
            source.disconnect(connectedDestination);
          } catch {
            // Already disconnected.
          }
        });
        activeConnectionsRef.current = [];
      };

      mediaRecorder.start();
      setIsPreviewPlaying(false);
      setRecordingState("recording");
    } catch (error) {
      stopMicrophone();
      activeConnectionsRef.current.forEach(({ source, destination }) => {
        try {
          source.disconnect(destination);
        } catch {
          // Already disconnected.
        }
      });
      activeConnectionsRef.current = [];
      setRecordingState("idle");
      window.alert(`\ub179\uc74c\uc744 \uc2dc\uc791\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4: ${error.message}`);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }

  async function togglePreview() {
    const audio = previewAudioRef.current;
    if (!audio || !previewUrl) return;
    if (audio.paused) {
      await audio.play();
      setIsPreviewPlaying(true);
    } else {
      audio.pause();
      setIsPreviewPlaying(false);
    }
  }

  function saveRecording() {
    if (!previewUrl) return;
    const link = document.createElement("a");
    link.href = previewUrl;
    link.download = previewName || "recording.webm";
    link.click();
  }

  function loadRecording(file) {
    if (!file) return;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    setPreviewUrl(URL.createObjectURL(file));
    setPreviewName(file.name);
    setIsPreviewPlaying(false);
    setPreviewTime(0);
    setPreviewDuration(0);
  }

  return (
    <div className={recordingState === "recording" ? "recorder-panel is-recording" : "recorder-panel"} aria-label="\ub179\uc74c\uae30">
      <button
        className={recordingState === "recording" ? "recorder-button recording" : "recorder-button"}
        type="button"
        onClick={recordingState === "recording" ? stopRecording : startRecording}
        title={recordingState === "recording" ? "\ub179\uc74c \uc885\ub8cc" : "\ud604\uc7ac \uc7ac\uc0dd\uc74c\uacfc \ub9c8\uc774\ud06c \ub179\uc74c"}
      >
        {recordingState === "recording" ? <Square size={15} fill="currentColor" /> : <Mic size={15} />}
        <span>{recordingState === "recording" ? "\uc815\uc9c0" : "\ub179\uc74c"}</span>
      </button>
      <span className={recordingState === "recording" ? "recorder-status active" : "recorder-status"}>
        {recordingState === "recording" ? `REC ${formatTime(recordingSeconds)}` : previewUrl ? "\ub179\uc74c\ud30c\uc77c" : "\ub300\uae30"}
      </span>
      <button
        className="recorder-icon-button"
        type="button"
        onClick={togglePreview}
        disabled={!previewUrl || recordingState === "recording"}
        title="\ub179\uc74c \ud30c\uc77c \uc7ac\uc0dd/\uc77c\uc2dc\uc815\uc9c0"
      >
        {isPreviewPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
      </button>
      <input
        className="recorder-seek"
        type="range"
        min="0"
        max={previewDuration || 0}
        step="0.1"
        value={Math.min(previewTime, previewDuration || 0)}
        disabled={!previewUrl || recordingState === "recording"}
        onChange={(event) => {
          const nextTime = Number(event.target.value);
          if (previewAudioRef.current) previewAudioRef.current.currentTime = nextTime;
          setPreviewTime(nextTime);
        }}
        aria-label="\ub179\uc74c \ud30c\uc77c \uc7ac\uc0dd \uc704\uce58"
      />
      <span className="recorder-time">
        {formatTime(previewTime)} / {formatTime(previewDuration)}
      </span>
      <button
        className="recorder-icon-button"
        type="button"
        onClick={saveRecording}
        disabled={!previewUrl || recordingState === "recording"}
        title="\ub179\uc74c \ud30c\uc77c \uc800\uc7a5"
      >
        <Save size={15} />
      </button>
      <label className="recorder-icon-button" title="\uc800\uc7a5\ud55c \ub179\uc74c \ud30c\uc77c \ubd88\ub7ec\uc624\uae30">
        <FolderOpen size={15} />
        <input
          type="file"
          accept="audio/*"
          onChange={(event) => {
            loadRecording(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      <audio
        ref={previewAudioRef}
        src={previewUrl}
        onLoadedMetadata={(event) => setPreviewDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setPreviewTime(event.currentTarget.currentTime || 0)}
        onEnded={() => setIsPreviewPlaying(false)}
        onPause={() => setIsPreviewPlaying(false)}
        preload="metadata"
      />
    </div>
  );
}
function PlayList({
  songs,
  selectedSong,
  onSelect,
  libraryStatus,
  isAdmin,
  onUploadSong,
  onRenameSong,
  onDeleteSong,
  onReorderSongs,
  onOpenLyrics
}) {
  const selectedIndex = songs.findIndex((song) => song.id === selectedSong.id);

  return (
    <section className="panel">
      <div className="section-title">
        <h2>플레이리스트</h2>
        <div className="section-actions">
          <span>{libraryStatus}</span>
          {isAdmin && <div className="playlist-order-actions" aria-label="Selected song order">
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
          </div>}
          {isAdmin && <label className="mini-file-button text-file-button">
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
          </label>}
        </div>
      </div>
      <SongList
        songs={songs}
        selectedSong={selectedSong}
        onSelect={onSelect}
        mode="play"
        editable={isAdmin}
        onUploadSong={onUploadSong}
        onRenameSong={onRenameSong}
        onDeleteSong={onDeleteSong}
        onOpenLyrics={onOpenLyrics}
      />
    </section>
  );
}

function LyricsWindow({ song, isAdmin, onClose, onSave }) {
  const [draft, setDraft] = useState(song.lyrics || "");
  const [isSaving, setIsSaving] = useState(false);
  const [windowSize, setWindowSize] = useState(() => ({
    width: clamp(Math.round(window.innerWidth * 0.42), 180, 460),
    height: clamp(Math.round(window.innerHeight * 0.42), 210, 460)
  }));
  const [windowPosition, setWindowPosition] = useState(() => {
    const width = clamp(Math.round(window.innerWidth * 0.42), 180, 460);
    const height = clamp(Math.round(window.innerHeight * 0.42), 210, 460);
    const bottomOffset = window.innerWidth <= 760 ? 276 : 198;
    return {
      left: clamp(window.innerWidth - width - 16, 8, window.innerWidth - width - 8),
      top: clamp(window.innerHeight - height - bottomOffset, 8, window.innerHeight - height - 8)
    };
  });
  const resizeStateRef = useRef(null);
  const moveStateRef = useRef(null);

  useEffect(() => {
    setDraft(song.lyrics || "");
  }, [song.id, song.lyrics]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const resizeState = resizeStateRef.current;
      const moveState = moveStateRef.current;
      if (!resizeState && !moveState) return;

      event.preventDefault();

      if (resizeState) {
        const right = resizeState.left + resizeState.width;
        const maxWidth = Math.max(180, Math.min(window.innerWidth - 24, right - 8));
        const maxHeight = Math.max(210, window.innerHeight - resizeState.top - 8);
        const nextWidth = clamp(resizeState.width - (event.clientX - resizeState.x), 180, maxWidth);
        const nextHeight = clamp(resizeState.height + event.clientY - resizeState.y, 210, maxHeight);
        setWindowSize({ width: nextWidth, height: nextHeight });
        setWindowPosition({
          left: clamp(right - nextWidth, 8, window.innerWidth - nextWidth - 8),
          top: resizeState.top
        });
        return;
      }

      setWindowPosition({
        left: clamp(moveState.left + event.clientX - moveState.x, 8, window.innerWidth - moveState.width - 8),
        top: clamp(moveState.top + event.clientY - moveState.y, 8, window.innerHeight - moveState.height - 8)
      });
    };
    const stopInteraction = () => {
      resizeStateRef.current = null;
      moveStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopInteraction);
    window.addEventListener("pointercancel", stopInteraction);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopInteraction);
      window.removeEventListener("pointercancel", stopInteraction);
    };
  }, []);

  function startResize(event) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeStateRef.current = {
      x: event.clientX,
      y: event.clientY,
      width: windowSize.width,
      height: windowSize.height,
      left: windowPosition.left,
      top: windowPosition.top
    };
  }

  function startMove(event) {
    if (event.target instanceof Element && event.target.closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    moveStateRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: windowPosition.left,
      top: windowPosition.top,
      width: windowSize.width,
      height: windowSize.height
    };
  }

  async function save() {
    setIsSaving(true);
    try {
      await onSave?.(song, draft);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <aside className="lyrics-window" style={{ ...windowSize, ...windowPosition }} aria-label="가사창">
      <div className="lyrics-window-head" onPointerDown={startMove}>
        <div>
          <span>가사</span>
          <strong>{song.title}</strong>
        </div>
        <button type="button" title="가사창 닫기" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {isAdmin ? (
        <div className="lyrics-editor">
          <textarea
            value={draft}
            placeholder="가사를 입력하세요."
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="button" onClick={save} disabled={isSaving}>
            {isSaving ? "저장 중" : "가사 저장"}
          </button>
        </div>
      ) : (
        <div className="lyrics-text">
          {song.lyrics?.trim() ? song.lyrics : "등록된 가사가 없습니다."}
        </div>
      )}
      <button className="lyrics-resize-handle" type="button" title="가사창 크기 조절" onPointerDown={startResize} />
    </aside>
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
  onOpenLyrics,
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
                mode === "play" && onOpenLyrics ? "has-lyrics-action" : "",
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
              {(mode === "play" && onOpenLyrics) && (
                <button
                  className="lyrics-list-button"
                  type="button"
                  title="가사 보기"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenLyrics(song);
                  }}
                >
                  <FileText size={15} />
                </button>
              )}
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
  isAdmin,
  splitRefs,
  isPlayerActive,
  splitVolumes,
  splitMuted,
  setSplitInstrumentVolume,
  onToggleSplitVolumeZero,
  setAllSplitVolumes,
  setCurrentTime,
  setDuration,
  setIsPlaying,
  onSplitAudioEnded,
  onAddSplitSong,
  onPlaySplitSong,
  onRenameSplitSong,
  onUploadSplitTrack,
  onUploadSplitTracks,
  onDeleteSplitTrack,
  onDeleteSplitSong,
  onReorderSplitSongs
}) {
  const [expandedSongId, setExpandedSongId] = useState(selectedSong.id);
  const selectedIndex = songs.findIndex((song) => song.id === selectedSong.id);

  function selectOrToggleSong(song) {
    onSelect(song);
    setExpandedSongId((current) => (current === song.id ? "" : song.id));
  }

  function renderSplitControls(song) {
    if (song.id !== selectedSong.id) return null;

    const splitAudios = instruments.map((instrument) => (
      <audio
        key={song.splitTrackPaths?.[instrument.key] || `${song.id}-${instrument.key}`}
        data-instrument={instrument.key}
        ref={(node) => {
          if (node) splitRefs.current[instrument.key] = node;
        }}
        src={song.splitTracks[instrument.key]}
        crossOrigin="anonymous"
        preload="metadata"
        onLoadedMetadata={(event) => {
          if (instrument.key === "vocal" && isPlayerActive) setDuration(event.currentTarget.duration);
        }}
        onTimeUpdate={(event) => {
          if (instrument.key === "vocal" && isPlayerActive) setCurrentTime(event.currentTarget.currentTime);
        }}
        onEnded={() => onSplitAudioEnded?.(instrument.key)}
      />
    ));

    if (expandedSongId !== song.id) {
      return <div className="split-hidden-audios">{splitAudios}</div>;
    }

    return (
      <div className="split-inline-controls">
        {isAdmin && <label className="split-bulk-upload-button" title="6개 분할 파일 일괄 업로드">
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
        </label>}

        <div className="preset-row split-preset-row" aria-label="전체 볼륨">
          <span>전체 볼륨</span>
          {[0, 0.3, 0.5, 0.7, 1].map((preset) => (
            <button key={preset} onClick={() => setAllSplitVolumes(preset)}>
              {Math.round(preset * 100)}%
            </button>
          ))}
        </div>

        <div className="mixer">
          {instruments.map((instrument) => {
            const isZeroVolume = (splitVolumes[instrument.key] ?? 0) <= 0;
            return (
            <div className={isAdmin ? "track-row admin-track-row" : "track-row"} key={instrument.key}>
              <div className="track-name">
                <label>{instrument.label}</label>
                <button
                  className={isZeroVolume ? "track-mute-button active" : "track-mute-button"}
                  type="button"
                  title={isZeroVolume ? `${instrument.label} 볼륨 복구` : `${instrument.label} 볼륨 0%`}
                  onClick={() => onToggleSplitVolumeZero?.(instrument.key)}
                >
                  {isZeroVolume ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={splitVolumes[instrument.key]}
                onChange={(event) => setSplitInstrumentVolume(instrument.key, Number(event.target.value))}
              />
              <span>{Math.round(splitVolumes[instrument.key] * 100)}%</span>
              {isAdmin && <label className="track-upload-button" title={`${instrument.label} 파일 업로드`}>
                <UploadCloud size={15} />
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(event) => {
                    onUploadSplitTrack?.(song, instrument.key, event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>}
              {isAdmin && <button
                className="track-delete-button"
                type="button"
                title={`${instrument.label} 파일 삭제`}
                disabled={!song.splitTrackPaths?.[instrument.key]}
                onClick={() => onDeleteSplitTrack?.(song, instrument.key)}
              >
                <Trash2 size={15} />
              </button>}
            </div>
            );
          })}
          {splitAudios}
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
          {isAdmin && <div className="playlist-order-actions" aria-label="Selected split song order">
            <button
              type="button"
              title="선택한 분할곡 위로"
              disabled={selectedIndex <= 0}
              onClick={() => onReorderSplitSongs?.(selectedIndex, selectedIndex - 1)}
            >
              <ArrowUp size={15} />
            </button>
            <button
              type="button"
              title="선택한 분할곡 아래로"
              disabled={selectedIndex === -1 || selectedIndex >= songs.length - 1}
              onClick={() => onReorderSplitSongs?.(selectedIndex, selectedIndex + 1)}
            >
              <ArrowDown size={15} />
            </button>
          </div>}
          {isAdmin && <button className="mini-file-button text-file-button" type="button" onClick={onAddSplitSong}>
            분할곡 추가
          </button>}
        </div>
      </div>
      <SongList
        songs={songs}
        selectedSong={selectedSong}
        onSelect={selectOrToggleSong}
        mode="split"
        renderSongAction={(song) => (
          <div className="split-row-actions">
            <button
              className="split-row-play-button"
              type="button"
              title="분할 전체 재생"
              disabled={!song.partsReady}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(song);
                setExpandedSongId(song.id);
                onPlaySplitSong?.(song);
              }}
            >
              <Play size={14} fill="currentColor" />
            </button>
            {isAdmin && <button
              className="split-row-delete-button"
              type="button"
              title="분할곡 이름 변경"
              disabled={song.id === "split-empty"}
              onClick={(event) => {
                event.stopPropagation();
                onRenameSplitSong?.(song);
              }}
            >
              <Pencil size={14} />
            </button>}
            {isAdmin && <button
              className="split-row-delete-button"
              type="button"
              title="분할곡 삭제"
              disabled={song.id === "split-empty"}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteSplitSong?.(song);
              }}
            >
              <Trash2 size={14} />
            </button>}
          </div>
        )}
        renderAfterSong={renderSplitControls}
      />
    </section>
  );
}

function orderScoreRows(rows, order) {
  if (!order?.length) return rows;
  return [...rows].sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function ScorePanel({
  sheets,
  songs,
  scoreOrder,
  sheetStatus,
  isAdmin,
  onUploadSheet,
  onDeleteSheet,
  onReorderScoreRows
}) {
  const [expandedSongId, setExpandedSongId] = useState("");
  const sheetGroups = useMemo(() => {
    const groups = Object.fromEntries(songs.map((song) => [song.id, []]));
    const extra = [];

    sheets.forEach((sheet) => {
      const folder = sheet.path.split("/")[0];
      if (groups[folder]) {
        groups[folder].push(sheet);
      } else {
        extra.push(sheet);
      }
    });

    return { groups, extra };
  }, [sheets, songs]);

  let scoreRows = songs.map((song) => ({
    id: song.id,
    title: song.title,
    sheets: sheetGroups.groups[song.id] ?? []
  }));

  if (sheetGroups.extra.length) {
    scoreRows.push({
      id: "common",
      title: "기타 악보",
      sheets: sheetGroups.extra
    });
  }

  scoreRows = orderScoreRows(scoreRows, scoreOrder);
  const selectedIndex = scoreRows.findIndex((row) => row.id === expandedSongId);
  const rowIds = scoreRows.map((row) => row.id);

  return (
    <section className="panel">
      <div className="section-title">
        <h2>악보</h2>
        <div className="section-actions">
          <span>{sheetStatus}</span>
          {isAdmin && <div className="playlist-order-actions" aria-label="Selected score row order">
            <button
              type="button"
              title="선택한 악보 목록 위로"
              disabled={selectedIndex <= 0}
              onClick={() => onReorderScoreRows?.(rowIds, selectedIndex, selectedIndex - 1)}
            >
              <ArrowUp size={15} />
            </button>
            <button
              type="button"
              title="선택한 악보 목록 아래로"
              disabled={selectedIndex === -1 || selectedIndex >= scoreRows.length - 1}
              onClick={() => onReorderScoreRows?.(rowIds, selectedIndex, selectedIndex + 1)}
            >
              <ArrowDown size={15} />
            </button>
          </div>}
        </div>
      </div>

      <div className="score-song-list">
        {scoreRows.length ? (
          scoreRows.map((row, index) => (
            <div className="score-song-group" key={row.id}>
              <div
                className={expandedSongId === row.id ? "song-row selected" : "song-row"}
                onClick={() => setExpandedSongId((current) => (current === row.id ? "" : row.id))}
              >
                <span className="song-number">{index + 1}</span>
                <button
                  className="song-main"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpandedSongId((current) => (current === row.id ? "" : row.id));
                  }}
                >
                  <span className="song-name">{row.title}</span>
                </button>
                <span className="song-meta">{row.sheets.length}</span>
              </div>

              {expandedSongId === row.id && (
                <div className="score-inline-list">
                  {isAdmin && row.id !== "common" && (
                    <label className="split-bulk-upload-button score-upload-button">
                      <UploadCloud size={16} />
                      <span>악보 파일 추가</span>
                      <input
                        type="file"
                        accept=".pdf,image/*"
                        multiple
                        onChange={(event) => {
                          onUploadSheet?.(songs.find((song) => song.id === row.id), event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  )}

                  {row.sheets.length ? (
                    row.sheets.map((score) => (
                      <div className="score-row" key={score.path}>
                        <a href={score.url} download>
                          <span>{score.label}</span>
                          <Download size={16} />
                        </a>
                        {isAdmin && (
                          <button type="button" title="악보 삭제" onClick={() => onDeleteSheet?.(score)}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="empty-list compact-empty">등록된 악보가 없습니다.</div>
                  )}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="empty-list">곡 목록을 불러오고 있습니다.</div>
        )}
      </div>
    </section>
  );
}

function AlbumLockedPanel({ album, onUnlock }) {
  return (
    <div className="album-locked-panel">
      <div className="album-lock-box">
        <Lock size={28} />
        <h2>앨범 잠금</h2>
        <button type="button" onClick={onUnlock}>
          폴더 열람하기
        </button>
        <p>{album?.title ? `${album.title} 폴더는 확인 질문을 맞힌 사람만 볼 수 있습니다.` : "앨범 사진은 확인 질문을 맞힌 사람만 볼 수 있습니다."}</p>
      </div>
    </div>
  );
}

function AlbumPanel({
  albums,
  selectedAlbum,
  albumStatus,
  isAdmin,
  unlockedAlbumIds,
  onSelectAlbum,
  onUnlockAlbum,
  onAddAlbumFolder,
  onRenameAlbumFolder,
  onUpdateAlbumAccess,
  onUploadAlbumPhotos,
  onDeleteAlbumFolder,
  onDeleteAlbumPhoto
}) {
  const [viewerIndex, setViewerIndex] = useState(null);
  const [photoPage, setPhotoPage] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const activeImage = viewerIndex === null ? null : selectedAlbum.images[viewerIndex];
  const totalPhotoPages = Math.max(1, Math.ceil(selectedAlbum.images.length / albumPageSize));
  const currentPhotoPage = Math.min(photoPage, totalPhotoPages - 1);
  const imageStartIndex = currentPhotoPage * albumPageSize;
  const visibleImages = selectedAlbum.images.slice(imageStartIndex, imageStartIndex + albumPageSize);
  const canManageAlbum = isAdmin && selectedAlbum.id !== "album-empty";
  const isAlbumUnlocked =
    isAdmin ||
    selectedAlbum.id === "album-empty" ||
    unlockedAlbumIds?.has(selectedAlbum.id) ||
    localStorage.getItem(`${albumAccessKeyPrefix}${selectedAlbum.id}`) === todayKey();

  useEffect(() => {
    setViewerIndex(null);
    setPhotoPage(0);
  }, [selectedAlbum.id]);

  useEffect(() => {
    if (photoPage > totalPhotoPages - 1) {
      setPhotoPage(totalPhotoPages - 1);
    }
  }, [photoPage, totalPhotoPages]);

  function moveViewer(offset) {
    if (!selectedAlbum.images.length) return;
    setViewerIndex((current) => {
      const index = current ?? 0;
      return (index + offset + selectedAlbum.images.length) % selectedAlbum.images.length;
    });
  }

  function handleAlbumDrop(event) {
    event.preventDefault();
    setIsDragOver(false);
    if (!canManageAlbum) return;
    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    onUploadAlbumPhotos?.(selectedAlbum, files);
  }

  return (
    <section className="split-layout">
      <div className="panel compact">
        <div className="section-title">
          <h2>앨범</h2>
          <div className="section-actions">
            <span>{albumStatus}</span>
            {isAdmin && <button className="mini-file-button text-file-button" type="button" onClick={onAddAlbumFolder}>
              폴더 추가
            </button>}
          </div>
        </div>
        <div className="song-list">
          {albums.map((album, index) => (
            <div
              key={album.id}
              className={[
                "song-row",
                isAdmin ? "with-action" : "",
                selectedAlbum.id === album.id ? "selected" : ""
              ]
                .filter(Boolean)
                .join(" ")}
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
              {isAdmin && (
                <div className="song-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    title="앨범 폴더명 변경"
                    disabled={album.id === "album-empty"}
                    onClick={() => onRenameAlbumFolder?.(album)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    title="열람 질문/정답 변경"
                    disabled={album.id === "album-empty"}
                    onClick={() => onUpdateAlbumAccess?.(album)}
                  >
                    <Lock size={15} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div
        className={isDragOver && canManageAlbum ? "panel album-panel drag-over" : "panel album-panel"}
        onDragOver={(event) => {
          if (!canManageAlbum) return;
          event.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setIsDragOver(false);
          }
        }}
        onDrop={handleAlbumDrop}
      >
        <div className="section-title">
          <h2>{selectedAlbum.title}</h2>
            <div className="section-actions">
            {canManageAlbum && <label className="mini-file-button text-file-button">
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
            </label>}
            {canManageAlbum && <button
              className="mini-file-button"
              type="button"
              title="열람 질문/정답 변경"
              onClick={() => onUpdateAlbumAccess?.(selectedAlbum)}
            >
              <Lock size={15} />
            </button>}
            {isAdmin && <button
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
            </button>}
          </div>
        </div>
        {!isAlbumUnlocked ? (
          <AlbumLockedPanel album={selectedAlbum} onUnlock={() => onUnlockAlbum?.(selectedAlbum)} />
        ) : selectedAlbum.images.length ? (
          <>
          <div className="photo-grid">
            {visibleImages.map((image, index) => (
              <div className="photo-thumb" key={image.path}>
                <button type="button" onClick={() => setViewerIndex(imageStartIndex + index)}>
                  <img src={image.thumbnailUrl || image.url} alt={image.label} loading="lazy" />
                </button>
                {isAdmin && <div className="photo-thumb-caption">
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
                </div>}
              </div>
            ))}
          </div>
          {totalPhotoPages > 1 && (
            <div className="photo-pagination">
              <button
                type="button"
                disabled={currentPhotoPage === 0}
                onClick={() => setPhotoPage((page) => Math.max(0, page - 1))}
              >
                이전
              </button>
              <span>
                {currentPhotoPage + 1} / {totalPhotoPages}
              </span>
              <button
                type="button"
                disabled={currentPhotoPage >= totalPhotoPages - 1}
                onClick={() => setPhotoPage((page) => Math.min(totalPhotoPages - 1, page + 1))}
              >
                다음
              </button>
            </div>
          )}
          </>
        ) : (
          <div className="empty-list">
            {canManageAlbum ? "사진을 선택하거나 여기로 드래그해서 업로드하세요." : "등록된 사진이 없습니다."}
          </div>
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
            <strong>
              {(viewerIndex ?? 0) + 1} / {selectedAlbum.images.length}
            </strong>
          </div>
        </div>
      )}
    </section>
  );
}

const whiteKeys = [
  { note: "C", label: "도" },
  { note: "D", label: "레" },
  { note: "E", label: "미" },
  { note: "F", label: "파" },
  { note: "G", label: "솔" },
  { note: "A", label: "라" },
  { note: "B", label: "시" }
];

const blackKeys = [
  { note: "C#", label: "도#", left: 1 },
  { note: "D#", label: "레#", left: 2 },
  { note: "F#", label: "파#", left: 4 },
  { note: "G#", label: "솔#", left: 5 },
  { note: "A#", label: "라#", left: 6 }
];

const noteOffsets = {
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  A: 9,
  "A#": 10,
  B: 11
};

function noteFrequency(note, octave) {
  const midi = (octave + 1) * 12 + noteOffsets[note];
  return 440 * 2 ** ((midi - 69) / 12);
}

function getInstrumentAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const context = getInstrumentAudioContext.context ?? new AudioContext();
  getInstrumentAudioContext.context = context;
  if (context.state === "suspended") context.resume().catch(() => {});
  return context;
}

function getInstrumentOutput(context) {
  if (!getInstrumentOutput.output || getInstrumentOutput.context !== context) {
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    master.gain.setValueAtTime(2.55, context.currentTime);
    compressor.threshold.setValueAtTime(-12, context.currentTime);
    compressor.knee.setValueAtTime(18, context.currentTime);
    compressor.ratio.setValueAtTime(5, context.currentTime);
    compressor.attack.setValueAtTime(0.003, context.currentTime);
    compressor.release.setValueAtTime(0.18, context.currentTime);
    master.connect(compressor);
    compressor.connect(context.destination);
    getInstrumentOutput.context = context;
    getInstrumentOutput.output = master;
  }
  return getInstrumentOutput.output;
}

function playPianoTone(note, octave) {
  const context = getInstrumentAudioContext();
  if (!context) return;
  const output = getInstrumentOutput(context);

  const now = context.currentTime;
  const frequency = noteFrequency(note, octave);
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const tone = context.createBiquadFilter();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, now);
  tone.type = "lowpass";
  tone.frequency.setValueAtTime(2200, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.74, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.32, now + 0.16);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);

  oscillator.connect(tone);
  tone.connect(gain);
  gain.connect(output);
  oscillator.start(now);
  oscillator.stop(now + 0.95);
}

function createNoiseBuffer(context, length = 0.22) {
  const sampleCount = Math.floor(context.sampleRate * length);
  const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const output = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i += 1) {
    output[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

const drumPads = [
  { key: "kick", label: "킥", sub: "Kick", visual: "kick" },
  { key: "hat", label: "하이햇", sub: "Hi-Hat", visual: "hat" },
  { key: "snare", label: "스네어", sub: "Snare", visual: "snare" },
  { key: "highTom", label: "하이탐", sub: "High Tom", visual: "tom" },
  { key: "lowTom", label: "로우탐", sub: "Low Tom", visual: "tom" },
  { key: "midTom", label: "미드탐", sub: "Mid Tom", visual: "tom" },
  { key: "rimshot", label: "림샷", sub: "Rimshot", visual: "rim" },
  { key: "crash", label: "크래시", sub: "Crash", visual: "cymbal" },
  { key: "clap", label: "클랩", sub: "Clap", visual: "clap" },
  { key: "openHat", label: "오픈하이햇", sub: "Open Hat", visual: "openhat" }
];

const tomSettings = {
  highTom: { start: 285, end: 155, filter: 620 },
  midTom: { start: 215, end: 105, filter: 470 },
  lowTom: { start: 155, end: 68, filter: 330 }
};

function playDrumSound(type) {
  const context = getInstrumentAudioContext();
  if (!context) return;

  const now = context.currentTime;
  const destination = getInstrumentOutput(context);

  if (type === "kick") {
    const osc = context.createOscillator();
    const gain = context.createGain();
    const click = context.createBufferSource();
    const clickFilter = context.createBiquadFilter();
    const clickGain = context.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(158, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.13);
    gain.gain.setValueAtTime(1.85, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    osc.connect(gain);
    gain.connect(destination);

    click.buffer = createNoiseBuffer(context, 0.035);
    clickFilter.type = "highpass";
    clickFilter.frequency.setValueAtTime(2100, now);
    clickGain.gain.setValueAtTime(0.68, now);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(destination);

    osc.start(now);
    click.start(now);
    osc.stop(now + 0.28);
    click.stop(now + 0.04);
    return;
  }

  const noise = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  noise.buffer = createNoiseBuffer(context, type === "crash" || type === "openHat" ? 0.8 : 0.25);

  if (type === "snare" || type === "rimshot" || type === "clap") {
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(type === "rimshot" ? 2600 : type === "clap" ? 1700 : 1800, now);
    gain.gain.setValueAtTime(type === "rimshot" ? 0.9 : type === "clap" ? 1.02 : 1.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (type === "rimshot" ? 0.09 : type === "clap" ? 0.16 : 0.24));
  } else if (type === "hat" || type === "openHat") {
    filter.type = "highpass";
    filter.frequency.setValueAtTime(type === "openHat" ? 5200 : 7200, now);
    gain.gain.setValueAtTime(type === "openHat" ? 0.72 : 0.78, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (type === "openHat" ? 0.48 : 0.08));
  } else if (type === "crash") {
    filter.type = "highpass";
    filter.frequency.setValueAtTime(3600, now);
    gain.gain.setValueAtTime(1.02, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);
  } else {
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(tomSettings[type]?.filter ?? 420, now);
    gain.gain.setValueAtTime(1.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  }

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  noise.start(now);
  noise.stop(now + (type === "crash" || type === "openHat" ? 0.8 : 0.28));

  if (type === "clap") {
    [0.018, 0.036].forEach((offset) => {
      const slap = context.createBufferSource();
      const slapFilter = context.createBiquadFilter();
      const slapGain = context.createGain();
      slap.buffer = createNoiseBuffer(context, 0.08);
      slapFilter.type = "bandpass";
      slapFilter.frequency.setValueAtTime(1900, now + offset);
      slapGain.gain.setValueAtTime(0.34, now + offset);
      slapGain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.07);
      slap.connect(slapFilter);
      slapFilter.connect(slapGain);
      slapGain.connect(destination);
      slap.start(now + offset);
      slap.stop(now + offset + 0.08);
    });
  }

  if (type === "rimshot") {
    const stick = context.createOscillator();
    const stickGain = context.createGain();
    stick.type = "square";
    stick.frequency.setValueAtTime(920, now);
    stickGain.gain.setValueAtTime(0.52, now);
    stickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    stick.connect(stickGain);
    stickGain.connect(destination);
    stick.start(now);
    stick.stop(now + 0.06);
  }

  if (tomSettings[type]) {
    const tom = tomSettings[type];
    const osc = context.createOscillator();
    const oscGain = context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(tom.start, now);
    osc.frequency.exponentialRampToValueAtTime(tom.end, now + 0.24);
    oscGain.gain.setValueAtTime(0.86, now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(oscGain);
    oscGain.connect(destination);
    osc.start(now);
    osc.stop(now + 0.32);
  }
}

function KeyboardPanel() {
  const octaves = [3, 4, 5, 6];
  const [activeKeys, setActiveKeys] = useState(() => new Set());

  function pressKey(note, octave) {
    const id = `${note}-${octave}`;
    setActiveKeys((current) => new Set([...current, id]));
    playPianoTone(note, octave);
  }

  function releaseKey(note, octave) {
    const id = `${note}-${octave}`;
    setActiveKeys((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  return (
    <section className="panel keyboard-panel">
      <div className="section-title">
        <h2>건반</h2>
        <span>4옥타브</span>
      </div>
      <div className="instrument-section">
      <div className="keyboard-stack">
        {octaves.map((octave, index) => (
          <div className="octave-row" key={octave}>
            <div className="octave-label">{index + 1}옥타브</div>
            <div className="piano-octave">
              <div className="white-key-row">
                {whiteKeys.map((key) => (
                  <button
                    className={activeKeys.has(`${key.note}-${octave}`) ? "piano-key white-key pressed" : "piano-key white-key"}
                    key={key.note}
                    type="button"
                    onPointerDown={() => pressKey(key.note, octave)}
                    onPointerUp={() => releaseKey(key.note, octave)}
                    onPointerCancel={() => releaseKey(key.note, octave)}
                    onPointerLeave={() => releaseKey(key.note, octave)}
                  >
                    <span>{key.label}</span>
                    <small>{key.note}{index + 1}</small>
                  </button>
                ))}
              </div>
              <div className="black-key-row">
                {blackKeys.map((key) => (
                  <button
                    className={activeKeys.has(`${key.note}-${octave}`) ? "piano-key black-key pressed" : "piano-key black-key"}
                    key={key.note}
                    type="button"
                    style={{ left: `${(key.left / 7) * 100}%` }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      pressKey(key.note, octave);
                    }}
                    onPointerUp={() => releaseKey(key.note, octave)}
                    onPointerCancel={() => releaseKey(key.note, octave)}
                    onPointerLeave={() => releaseKey(key.note, octave)}
                  >
                    <span>{key.label}</span>
                    <small>{key.note}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      </div>
    </section>
  );
}

function DrumPanel() {
  const [activeDrum, setActiveDrum] = useState("");

  function hitDrum(type) {
    setActiveDrum(type);
    playDrumSound(type);
    window.setTimeout(() => {
      setActiveDrum((current) => (current === type ? "" : current));
    }, 120);
  }

  return (
    <section className="panel keyboard-panel">
      <div className="section-title">
        <h2>드럼</h2>
        <span>10개 패드</span>
      </div>
      <div className="instrument-section">
        <div className="drum-pad-grid">
          {drumPads.map((pad) => (
            <button
              key={pad.key}
              className={activeDrum === pad.key ? "drum-pad active" : "drum-pad"}
              type="button"
              onPointerDown={(event) => {
                event.preventDefault();
                hitDrum(pad.key);
              }}
            >
              <span className={`drum-visual drum-visual-${pad.visual}`} aria-hidden="true" />
              <span className="drum-label">{pad.label}</span>
              <small>{pad.sub}</small>
            </button>
          ))}
        </div>
      </div>
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
  keyShift,
  setKeyShift,
  volume,
  setVolume,
  abLoop,
  markAbLoop,
  togglePlay,
  seekBy,
  seekTo,
  moveSong,
  restartCurrent,
  playSequenceMode,
  cyclePlaySequenceMode,
  onEnded
}) {
  const abStartPercent =
    abLoop.start !== null && duration ? clamp((abLoop.start / duration) * 100, 0, 100) : null;
  const abEndPercent = abLoop.end !== null && duration ? clamp((abLoop.end / duration) * 100, 0, 100) : null;

  return (
    <footer className={activeTab === "split" ? "player split-player" : "player play-player"}>
      <audio
        ref={audioRef}
        src={selectedSong.audioUrl}
        crossOrigin="anonymous"
        preload="metadata"
        onLoadedMetadata={(event) => {
          if (activeTab !== "split") setDuration(event.currentTarget.duration);
        }}
        onTimeUpdate={(event) => {
          if (activeTab !== "split") handleTrackedTime(event.currentTarget.currentTime);
        }}
        onEnded={onEnded}
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
      <div className="timeline-row">
        <button className="timeline-button" title="처음부터 다시 재생" onClick={restartCurrent}>
          {"\u21ba"}
        </button>
        <div className="seek-wrap">
          {abStartPercent !== null && (
            <span className="ab-marker ab-start" style={{ left: `${abStartPercent}%` }} title="A 지점" />
          )}
          {abEndPercent !== null && (
            <span className="ab-marker ab-end" style={{ left: `${abEndPercent}%` }} title="B 지점" />
          )}
          {abStartPercent !== null && abEndPercent !== null && (
            <span
              className="ab-range"
              style={{
                left: `${Math.min(abStartPercent, abEndPercent)}%`,
                width: `${Math.abs(abEndPercent - abStartPercent)}%`
              }}
            />
          )}
          <input
            className="seek"
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => seekTo(event.target.value)}
          />
        </div>
        <button className="timeline-button play-sequence-button" title="재생 방식 전환" onClick={cyclePlaySequenceMode}>
          {playSequenceLabels[playSequenceMode] ?? playSequenceLabels["list-once"]}
        </button>
      </div>

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
        <div className="key-control" aria-label="Key control">
          <button
            className="key-button"
            type="button"
            title="반음 낮추기"
            disabled={keyShift <= -8}
            onClick={() => setKeyShift((value) => clamp(value - 1, -8, 8))}
          >
            {"\u266d"}
          </button>
          <button
            className={keyShift === 0 ? "key-button active key-readout" : "key-button key-readout"}
            type="button"
            title="원음으로"
            onClick={() => setKeyShift(0)}
          >
            {keyShift > 0 ? `+${keyShift}` : `${keyShift}`}
          </button>
          <button
            className="key-button"
            type="button"
            title="반음 올리기"
            disabled={keyShift >= 8}
            onClick={() => setKeyShift((value) => clamp(value + 1, -8, 8))}
          >
            #
          </button>
        </div>
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
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((registration) => {
        registration.update().catch(() => {});
      })
      .catch(() => {});
  });
}
