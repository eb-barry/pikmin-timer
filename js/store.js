import { SOUNDS } from "./catalog.js";
import { DEFAULT_COOLDOWN_MIN, MAX_TIMERS } from "./time.js";

export const STORAGE_KEY = "pikmin-timer-v1";

export const defaultSettings = {
  floorId: "floor-01",
  soundId: SOUNDS[0].id,
  cooldownMin: DEFAULT_COOLDOWN_MIN,
  keepAwake: false,
  workMode: false
};

function validTimer(timer) {
  if (!timer || typeof timer.id !== "string" || typeof timer.location !== "string") return false;
  return timer.respawnAt == null || Number.isFinite(Number(timer.respawnAt));
}

export function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const settings = { ...defaultSettings, ...(raw.settings || {}) };
    if (!/^floor-(0[1-9]|1[0-3])$/.test(settings.floorId)) settings.floorId = defaultSettings.floorId;
    if (!SOUNDS.some((sound) => sound.id === settings.soundId)) settings.soundId = defaultSettings.soundId;
    const cooldown = Number(settings.cooldownMin);
    settings.cooldownMin = Number.isFinite(cooldown) ? Math.min(30, Math.max(0, Math.round(cooldown))) : DEFAULT_COOLDOWN_MIN;
    settings.keepAwake = Boolean(settings.keepAwake);
    settings.workMode = Boolean(settings.workMode);
    const timers = (Array.isArray(raw.timers) ? raw.timers : [])
      .filter(validTimer)
      .slice(0, MAX_TIMERS)
      .map((timer) => ({
        id: timer.id,
        location: timer.location.trim(),
        respawnAt: timer.respawnAt == null ? null : Number(timer.respawnAt),
        createdAt: Number(timer.createdAt) || (Number.isFinite(Number(timer.respawnAt)) ? Number(timer.respawnAt) : Date.now())
      }));
    return { settings, timers };
  } catch {
    return { settings: { ...defaultSettings }, timers: [] };
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    settings: state.settings,
    timers: state.timers
  }));
}
