const MUSIC_KEY = "shardify:music-volume";
export const MUSIC_VOLUME_EVENT = "shardify:music-volume-change";

export function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.9;
}

export function getMusicVolume(): number {
  if (typeof window === "undefined") return 0.9;
  try {
    const saved = window.localStorage.getItem(MUSIC_KEY);
    return saved === null ? 0.9 : clampVolume(Number(saved));
  } catch {
    return 0.9;
  }
}

export function setMusicVolume(value: number) {
  const volume = clampVolume(value);
  try { window.localStorage.setItem(MUSIC_KEY, String(volume)); } catch { /* unavailable storage */ }
  window.dispatchEvent(new CustomEvent(MUSIC_VOLUME_EVENT, { detail: volume }));
}