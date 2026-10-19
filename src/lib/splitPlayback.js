export function getSplitAudios(refs, song) {
  return Object.entries(song.splitTracks ?? {}).flatMap(([key, src]) => {
    const audio = refs[key];
    return src && audio && audio.dataset.songId === song.id ? [audio] : [];
  });
}

export function getSplitClock(refs, song) {
  const audios = getSplitAudios(refs, song).filter((audio) => !audio.error);
  const audio = audios.reduce((longest, current) => {
    const duration = Number.isFinite(current.duration) ? current.duration : 0;
    const previous = Number.isFinite(longest?.duration) ? longest.duration : 0;
    return !longest || duration > previous ? current : longest;
  }, null);
  return { audio, key: audio?.dataset.instrument, duration: Number.isFinite(audio?.duration) ? audio.duration : 0 };
}

export async function playSplitAudioGroup(audios, time, configure, isCurrent = () => true) {
  if (!audios.length) return false;
  const playable = audios.filter((audio) => !Number.isFinite(audio.duration) || time < audio.duration || time === 0);
  if (!playable.length) return false;
  const results = await Promise.allSettled(playable.map(async (audio) => {
    audio.currentTime = time;
    configure(audio);
    await audio.play();
  }));
  if (!isCurrent()) return false;
  const failures = results.flatMap((result, index) => result.status === "rejected" ? [playable[index].dataset.instrument] : []);
  if (failures.length) {
    audios.forEach((audio) => audio.pause());
    throw new Error(`일부 분할 음원을 재생하지 못했습니다 (${failures.join(", ")}). 파일과 연결 상태를 확인해주세요.`);
  }
  return true;
}
