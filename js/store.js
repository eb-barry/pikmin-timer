import { SOUNDS } from "./catalog.js";
import { MAX_TIMERS, clampCooldown } from "./time.js";

export const STORAGE_KEY = "pikmin-timer-v1";
const SETTINGS_VERSION = 2;

export const defaultSettings = {
  floorId: "floor-01",
  soundId: "羽翅",
  cooldownMin: 4,
  cooldownSec: 0,
  keepAwake: true,
  workMode: true
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
    settings.keepAwake = Boolean(settings.keepAwake);
    settings.workMode = Boolean(settings.workMode);
    if ((Number(raw.settingsVersion) || 1) < SETTINGS_VERSION) {
      settings.soundId = defaultSettings.soundId;
      settings.cooldownMin = defaultSettings.cooldownMin;
      settings.cooldownSec = defaultSettings.cooldownSec;
      settings.workMode = defaultSettings.workMode;
      settings.keepAwake = defaultSettings.keepAwake;
    }
    if (!SOUNDS.some((sound) => sound.id === settings.soundId)) settings.soundId = defaultSettings.soundId;
    Object.assign(settings, clampCooldown(settings.cooldownMin, settings.cooldownSec));
    const timers = (Array.isArray(raw.timers) ? raw.timers : [])
      .filter(validTimer)
      .slice(0, MAX_TIMERS)
      .map((timer) => ({
        id: timer.id,
        location: timer.location.trim(),
        respawnAt: timer.respawnAt == null ? null : Number(timer.respawnAt),
        createdAt: Number(timer.createdAt) || (Number.isFinite(Number(timer.respawnAt)) ? Number(timer.respawnAt) : Date.now())
      }));
    if ((Number(raw.settingsVersion) || 1) < SETTINGS_VERSION) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        settings,
        settingsVersion: SETTINGS_VERSION,
        timers
      }));
    }
    return { settings, timers };
  } catch {
    return { settings: { ...defaultSettings }, timers: [] };
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    settings: state.settings,
    settingsVersion: SETTINGS_VERSION,
    timers: state.timers
  }));
}
