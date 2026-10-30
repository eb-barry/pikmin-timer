// The alarm is an absolute respawn instant: screenshot clock + remaining
// destruction time + cooldown. The digits are that instant minus now.

export const MAX_TIMERS = 6;
export const ALARM_MS = 30 * 1000;
export const DEFAULT_COOLDOWN_MIN = 4;
export const JUST_TAKEN_MS = 90 * 1000;
export const FUTURE_SLACK_MS = 2 * 60 * 1000;
export const WAKE_WINDOW_MS = 5 * 60 * 1000;

export function pad(value, width = 2) {
  return String(Math.max(0, Math.trunc(value))).padStart(width, "0");
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatClock(date, { seconds = true } = {}) {
  const text = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return seconds ? `${text}:${pad(date.getSeconds())}` : text;
}

export function toDateInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toTimeInput(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function suggestAnchor({ hour, minute, meridiem = null, now }) {
  const h = Number(hour);
  const min = Number(minute);
  let hours;
  if (meridiem === "am") hours = [h % 12];
  else if (meridiem === "pm") hours = [(h % 12) + 12];
  else if (h === 0 || h > 12) hours = [h];
  else hours = [h % 12, (h % 12) + 12];

  const candidates = [];
  for (const hourValue of hours) {
    for (const dayOffset of [-1, 0, 1]) {
      const dt = new Date(now.getTime());
      dt.setDate(dt.getDate() + dayOffset);
      dt.setHours(hourValue, min, 0, 0);
      candidates.push(dt);
    }
  }

  const past = candidates.filter((dt) => dt.getTime() <= now.getTime() + FUTURE_SLACK_MS);
  const pool = past.length ? past : candidates;
  pool.sort((a, b) => Math.abs(a.getTime() - now.getTime()) - Math.abs(b.getTime() - now.getTime()));
  const best = pool[0];
  if (Math.abs(best.getTime() - now.getTime()) <= JUST_TAKEN_MS) {
    return { anchor: new Date(now.getTime()), usedNow: true };
  }
  return { anchor: best, usedNow: false };
}

export function draftToRespawn(draft, cooldownMs) {
  const [year, month, day] = String(draft.anchorDate || "").split("-").map(Number);
  const [hours, minutes] = String(draft.anchorTime || "").split(":").map(Number);
  const seconds = Number(draft.anchorSeconds) || 0;
  if (![year, month, day, hours, minutes].every((n) => Number.isFinite(n))) return null;
  const anchor = new Date(year, month - 1, day, hours, minutes, seconds, 0);
  if (Number.isNaN(anchor.getTime())) return null;
  const destroy = (((Number(draft.hours) || 0) * 60 + (Number(draft.minutes) || 0)) * 60 + (Number(draft.seconds) || 0)) * 1000;
  return new Date(anchor.getTime() + destroy + (Number(cooldownMs) || 0));
}

export function describeDraft(draft, cooldownMs, now) {
  const respawn = draftToRespawn(draft, cooldownMs);
  if (!respawn || Number.isNaN(respawn.getTime())) return null;
  const remaining = respawn.getTime() - now.getTime();
  return {
    respawn,
    remaining,
    past: remaining <= 0,
    respawnText: formatClock(respawn, { seconds: true }),
    countdownText: formatCountdown(Math.max(0, remaining))
  };
}

export function toggleMeridiem(timeStr) {
  const [hours, minutes] = String(timeStr).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return timeStr;
  const next = hours >= 12 ? hours - 12 : hours + 12;
  return `${pad(next)}:${pad(minutes)}`;
}

export function meridiemLabel(timeStr) {
  const hours = Number(String(timeStr).split(":")[0]);
  return hours >= 12 ? "改成上午" : "改成下午";
}

export function shiftAnchor(dateStr, timeStr, seconds, deltaMinutes) {
  const [year, month, day] = String(dateStr).split("-").map(Number);
  const [hours, minutes] = String(timeStr).split(":").map(Number);
  const dt = new Date(year, month - 1, day, hours, minutes, Number(seconds) || 0, 0);
  dt.setMinutes(dt.getMinutes() + deltaMinutes);
  return {
    anchorDate: toDateInput(dt),
    anchorTime: toTimeInput(dt),
    anchorSeconds: dt.getSeconds()
  };
}

export function sortTimers(timers) {
  return [...timers].sort((a, b) => a.respawnAt - b.respawnAt || a.createdAt - b.createdAt);
}

export function splitBoard(timers) {
  const sorted = sortTimers(timers);
  if (!sorted.length) return { hero: null, rest: [] };
  return { hero: sorted[0], rest: sorted.slice(1) };
}

export function alarmOrder(timers, now) {
  return sortTimers(timers).filter((timer) => timer.respawnAt <= now).map((timer) => timer.id);
}

export function classifyDrafts(existing, drafts) {
  const lastIndex = new Map();
  drafts.forEach((draft, index) => {
    const key = draft.location.trim();
    if (key) lastIndex.set(key, index);
  });
  const notes = drafts.map((draft, index) => {
    const key = draft.location.trim();
    if (!key) return "need-location";
    if (lastIndex.get(key) !== index) return "duplicate-lost";
    if (existing.some((timer) => timer.location.trim() === key)) return "replace";
    return "add";
  });
  const names = new Set(existing.map((timer) => timer.location.trim()).filter(Boolean));
  for (const draft of drafts) {
    const key = draft.location.trim();
    if (key) names.add(key);
  }
  const empties = drafts.filter((draft) => !draft.location.trim()).length;
  const total = names.size + empties;
  return {
    notes,
    total,
    overflow: Math.max(0, total - MAX_TIMERS)
  };
}

export function canStart(classification, drafts) {
  if (!drafts.length || classification.overflow > 0) return false;
  if (classification.notes.some((note) => note === "need-location" || note === "duplicate-lost")) return false;
  return drafts.every((draft) => draft.remainingReady);
}

export function applyReading(draft, reading, now) {
  if (!draft.locationDirty && reading.location) draft.location = reading.location;
  if (!draft.remainingDirty && reading.remaining) {
    draft.hours = reading.remaining.hours;
    draft.minutes = reading.remaining.minutes;
    draft.seconds = reading.remaining.seconds;
    draft.remainingReady = true;
  }
  if (!draft.anchorDirty && reading.clock) {
    const suggested = suggestAnchor({ ...reading.clock, now });
    draft.anchorDate = toDateInput(suggested.anchor);
    draft.anchorTime = toTimeInput(suggested.anchor);
    draft.anchorSeconds = suggested.anchor.getSeconds();
    draft.usedNow = suggested.usedNow;
  }
}
