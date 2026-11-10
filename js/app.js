import { clockButton } from "./clock.js";
import { FLOORS, SOUNDS, floorThumbUrl, floorUrl, soundUrl } from "./catalog.js";
import { createAlarms, unlockAudio } from "./audio.js";
import { recognizeScreenshot } from "./ocr.js";
import { loadState, saveState } from "./store.js";
import { APP_VERSION } from "./version.js";
import {
  ringableOrder,
  applyReading,
  formatClock,
  formatCountdown,
  MAX_TIMERS,
  clampCooldown,
  clampDimIdle,
  cooldownDuration,
  nextTimers,
  splitBoard,
  toDateInput,
  toTimeInput
} from "./time.js";

const loaded = loadState();
const state = {
  settings: loaded.settings,
  timers: loaded.timers,
  sheet: null,
  layoutSig: "",
  reading: null
};

const app = document.getElementById("app");
const board = document.getElementById("board");
const sheet = document.getElementById("sheet");
const panel = sheet.querySelector(".sheet-panel");
const fileInput = document.getElementById("fileInput");
const muteBtn = document.getElementById("muteBtn");
const readout = document.getElementById("reading");
const workCover = document.getElementById("workCover");
const dimCover = document.getElementById("dimCover");
const dimDigits = document.getElementById("dimDigits");
const appVersion = document.getElementById("appVersion");
const settingsBtn = document.getElementById("settingsBtn");
let readGeneration = 0;
let noticeTimer = 0;

app.style.backgroundImage = `url("${floorUrl(state.settings.floorId)}")`;

const alarms = createAlarms({
  getSoundUrl: () => soundUrl(state.settings.soundId),
  onDone: (id) => removeTimer(id),
  onFinished: (id) => holdForDelete(id),
  onChange: paintAlarmChrome
});

appVersion.textContent = APP_VERSION;
settingsBtn.setAttribute("aria-label", `設定，版本 ${APP_VERSION}`);
document.getElementById("uploadBtn").addEventListener("click", () => fileInput.click());
settingsBtn.addEventListener("click", openSettings);
muteBtn.addEventListener("click", () => alarms.mute());
fileInput.addEventListener("change", () => {
  const files = [...fileInput.files];
  fileInput.value = "";
  if (files.length) receiveFiles(files);
});
board.addEventListener("click", (event) => {
  const dismiss = event.target.closest("[data-action=delete-alarm]");
  if (dismiss) {
    event.preventDefault();
    event.stopPropagation();
    const id = dismiss.closest(".clock")?.dataset.id;
    if (id) removeTimer(id);
    return;
  }
  const clock = event.target.closest(".clock");
  if (!clock) return;
  const fromKeyboard = event.detail === 0;
  if (!fromKeyboard && !event.target.closest(".face-hit")) return;
  if (clock.dataset.empty) {
    fileInput.click();
    return;
  }
  openEdit(clock.dataset.id);
});
sheet.addEventListener("click", onSheetClick);
sheet.addEventListener("input", onSheetInput);
sheet.addEventListener("change", onSheetChange);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.sheet) closeSheet();
});
document.addEventListener("pointerdown", () => {
  unlockAudio(soundUrl(state.settings.soundId));
}, { once: true });
document.addEventListener("pointerdown", (event) => {
  if (alarms.needsGesture()) alarms.playFromGesture();
  wakeFailed = false;
  noteActivity(event);
  syncWakeLock();
});
document.addEventListener("click", onWorkCoverClick);
workCover.addEventListener("click", (event) => {
  event.stopPropagation();
  hideWorkCover();
});
dimCover.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  lastActivityAt = Date.now();
  hideDim();
});
document.addEventListener("contextmenu", (event) => {
  if (event.target.closest("input, textarea")) return;
  event.preventDefault();
});
document.addEventListener("selectstart", (event) => {
  if (event.target.closest("input, textarea")) return;
  event.preventDefault();
});
document.addEventListener("dragstart", (event) => {
  if (event.target.closest("input, textarea")) return;
  event.preventDefault();
});
document.addEventListener("visibilitychange", () => {
  wakeFailed = false;
  if (document.visibilityState !== "visible") return;
  // Coming back is a new look. A mushroom that respawned while we were away stays quiet.
  arrive(Date.now());
  tick();
});

function onWorkCoverClick(event) {
  if (!state.settings.workMode || !state.timers.length || state.sheet || !workCover.hidden) return;
  // Keyboard activation of a clock opens the editor. A pointer tap on the words does too.
  // Every other tap on the main screen covers it with the work picture.
  if (event.detail === 0) return;
  const blocked = event.composedPath().some((node) => (
    node instanceof Element
    && node.matches(".face-hit, .top-actions, .mute-btn, .work-cover, .dim-cover, a, input, label, .sheet, .gesture")
  ));
  if (blocked) return;
  workCover.hidden = false;
}

function hideWorkCover() {
  workCover.hidden = true;
}

let lastActivityAt = Date.now();

function currentDimIdleMs() {
  const override = Number(window.__PIKMIN_DIM_IDLE_MS);
  if (override > 0) return override;
  return clampDimIdle(state.settings.dimIdleMin) * 60 * 1000;
}

function noteActivity(event) {
  if (event.target instanceof Element && event.target.closest(".dim-cover")) return;
  lastActivityAt = Date.now();
  hideDim();
}

const restTheme = document.querySelector('meta[name="theme-color"]')?.getAttribute("content") || "#16382c";

function setMeta(name, content) {
  const current = document.querySelector(`meta[name="${name}"]`);
  if (current?.getAttribute("content") === content) return;
  const next = document.createElement("meta");
  next.setAttribute("name", name);
  next.setAttribute("content", content);
  if (current) current.replaceWith(next);
  else document.head.append(next);
}

function setDimChrome(active) {
  document.documentElement.classList.toggle("dim-chrome", active);
  setMeta("color-scheme", active ? "dark" : "light");
  setMeta("theme-color", active ? "#000000" : restTheme);
}

function hideDim() {
  dimCover.hidden = true;
  setDimChrome(false);
}

function alarmNeedsTheScreen() {
  return Boolean(alarms.playingId()) || awaitingDelete.size > 0;
}

function paintDimDigits() {
  const source = board.querySelector(".clock-lg [data-part=digits]");
  const text = source?.textContent || "";
  setText(dimDigits, text);
  dimCover.setAttribute("aria-label", text ? `倒數 ${text}，點一下回到畫面` : "點一下回到畫面");
  if (!source) return;
  const box = source.getBoundingClientRect();
  dimDigits.style.left = `${box.left + box.width / 2}px`;
  dimDigits.style.top = `${box.top + box.height / 2}px`;
  dimDigits.style.fontSize = getComputedStyle(source).fontSize;
}

function syncDim(now) {
  if (alarmNeedsTheScreen()) {
    hideDim();
    return;
  }
  if (document.visibilityState !== "visible") return;
  if (dimCover.hidden) {
    if (now - lastActivityAt < currentDimIdleMs()) return;
    dimCover.hidden = false;
    setDimChrome(true);
  }
  paintDimDigits();
}

// Seen-ahead ids are mushrooms whose respawn was still in the future while this
// page was on screen. Entry, and a gap long enough that we were not watching,
// forgets that list except for a ring that is already playing.
const SEEN_AHEAD_GAP_MS = 60 * 1000;
const seenAhead = new Set();
const awaitingDelete = new Set();
let lastSeenAt = 0;

function arrive(now) {
  const playing = alarms.playingId();
  seenAhead.clear();
  if (playing) seenAhead.add(playing);
  lastSeenAt = now;
}

function releaseGone(now) {
  const live = new Set(state.timers.map((timer) => timer.id));
  for (const id of [...awaitingDelete]) {
    const timer = state.timers.find((item) => item.id === id);
    const stillDue = timer && Number.isFinite(timer.respawnAt) && timer.respawnAt <= now;
    if (!live.has(id) || !stillDue) awaitingDelete.delete(id);
  }
  for (const id of [...seenAhead]) if (!live.has(id)) seenAhead.delete(id);
}

function noteVisible(now) {
  const playing = alarms.playingId();
  releaseGone(now);
  if (document.visibilityState !== "visible") {
    return { playing, due: playing ? [playing] : [] };
  }
  if (!lastSeenAt || now - lastSeenAt > SEEN_AHEAD_GAP_MS) arrive(now);
  state.timers.forEach((timer) => {
    if (Number.isFinite(timer.respawnAt) && timer.respawnAt > now) seenAhead.add(timer.id);
  });
  lastSeenAt = now;
  const due = ringableOrder(state.timers, now, seenAhead);
  if (!soundUrl(state.settings.soundId)) {
    due.forEach((id) => {
      if (id !== playing) awaitingDelete.add(id);
    });
  }
  return { playing, due };
}

function playableOrder(now) {
  const { playing, due } = noteVisible(now);
  if (!soundUrl(state.settings.soundId)) return playing ? [playing] : [];
  if (awaitingDelete.size && !playing) return [];
  return due.filter((id) => !awaitingDelete.has(id));
}

function removeTimer(id) {
  awaitingDelete.delete(id);
  seenAhead.delete(id);
  state.timers = state.timers.filter((timer) => timer.id !== id);
  saveState(state);
  if (state.sheet?.type === "edit" && state.sheet.id === id) closeSheet();
  paintBoard(Date.now(), true);
  alarms.setOrder(playableOrder(Date.now()));
}

function holdForDelete(id) {
  if (!state.timers.some((timer) => timer.id === id)) return;
  awaitingDelete.add(id);
  paintBoard(Date.now(), true);
  alarms.setOrder(playableOrder(Date.now()));
}

retireRespawned(Date.now());
paintBoard(Date.now(), true);
alarms.setOrder(playableOrder(Date.now()));
schedule();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

function schedule() {
  window.setTimeout(() => {
    tick();
    schedule();
  }, 1000 - (Date.now() % 1000) + 20);
}

function retireRespawned(now) {
  const { due } = noteVisible(now);
  const keep = new Set([...due, ...awaitingDelete]);
  const kept = state.timers.filter((timer) => (
    !Number.isFinite(timer.respawnAt) || timer.respawnAt > now || keep.has(timer.id)
  ));
  if (kept.length === state.timers.length) return;
  const ids = new Set(kept.map((timer) => timer.id));
  state.timers.forEach((timer) => {
    if (!ids.has(timer.id)) {
      seenAhead.delete(timer.id);
      awaitingDelete.delete(timer.id);
    }
  });
  state.timers = kept;
  saveState(state);
  if (state.sheet?.type === "edit" && !ids.has(state.sheet.id)) closeSheet();
}

function tick() {
  const now = Date.now();
  alarms.checkElapsed();
  retireRespawned(now);
  paintBoard(now);
  paintEditLive();
  alarms.setOrder(playableOrder(now));
  if (state.sheet?.type === "settings") paintPreviewButton();
  syncWakeLock();
  syncDim(now);
}

function paintBoard(now, force = false) {
  const { hero, rest } = splitBoard(state.timers);
  const signature = `${hero?.id || "empty"}|${rest.map((timer) => timer.id).join(",")}`;
  if (force || signature !== state.layoutSig) {
    const previous = [...board.querySelectorAll(".clock")].map((element) => ({
      id: element.dataset.id,
      box: element.getBoundingClientRect()
    }));
    state.layoutSig = signature;
    board.innerHTML = hero
      ? `${clockButton({ id: hero.id, size: "lg" })}<div class="rest-grid">${rest.map((timer) => clockButton({ id: timer.id, size: "sm" })).join("")}</div>`
      : clockButton({ id: "empty", size: "lg", empty: true });
    if (!hero) {
      const empty = board.querySelector(".clock");
      empty.querySelector("[data-part=place]").textContent = "上傳截圖";
      empty.querySelector("[data-part=digits]").textContent = "--:--:--";
      empty.querySelector("[data-part=end]").textContent = "--:--";
      empty.setAttribute("aria-label", "上傳蘑菇截圖，開始設定倒數");
    }
    moveClocks(previous);
  }
  if (!hero) return;
  updateClock(board.querySelector(".clock-lg"), hero, now, "lg");
  for (const timer of rest) {
    const element = board.querySelector(`.clock-sm[data-id="${CSS.escape(timer.id)}"]`);
    if (element) updateClock(element, timer, now, "sm");
  }
}

function updateClock(element, timer, now, size) {
  const named = timer.location.trim();
  const timed = Number.isFinite(timer.respawnAt);
  const place = element.querySelector("[data-part=place]");
  const digitsEl = element.querySelector("[data-part=digits]");
  const kindEl = element.querySelector("[data-part=kind]");
  const endEl = element.querySelector("[data-part=end]");
  const kind = String(timer.kind || "").trim();
  const label = element.querySelector(".end-label");
  const awaiting = timed && awaitingDelete.has(timer.id);
  label.classList.toggle("is-delete", awaiting);
  if (awaiting) label.dataset.action = "delete-alarm";
  else delete label.dataset.action;
  setText(label, awaiting ? "刪除" : "");
  place.classList.toggle("missing", !named);
  setText(place, named ? shownPlace(named, size) : "?");
  setText(kindEl, kind ? `（${kind}）` : "");
  if (!timed) {
    element.classList.add("is-live");
    element.classList.remove("is-ringing", "is-soon");
    digitsEl.classList.add("missing");
    endEl.classList.add("missing");
    setText(digitsEl, "?");
    setText(endEl, "?");
    element.setAttribute("aria-label", `${named || "地點未辨識"}，${kind ? `${kind}，` : ""}倒數未辨識`);
    return;
  }
  const remaining = timer.respawnAt - now;
  const ringing = remaining <= 0;
  element.classList.toggle("is-live", true);
  element.classList.toggle("is-ringing", ringing);
  element.classList.toggle("is-soon", !ringing && remaining < 60000);
  digitsEl.classList.remove("missing");
  endEl.classList.remove("missing");
  const digits = ringing ? "00:00:00" : formatCountdown(remaining);
  const end = ringing ? "重生了" : formatClock(new Date(timer.respawnAt), { seconds: size === "lg" });
  setText(digitsEl, digits);
  setText(endEl, end);
  const kindLabel = kind ? `${kind}，` : "";
  element.setAttribute("aria-label", awaiting
    ? `${named || "地點未辨識"}，${kindLabel}時間到，點擊刪除`
    : ringing
      ? `${named || "地點未辨識"}，${kindLabel}時間到，已重生`
      : `${named || "地點未辨識"}，${kindLabel}還剩 ${digits}，重生 ${end}`);
}

function shownPlace(name, size) {
  const chars = Array.from(name);
  if (size === "lg") {
    if (chars.length <= 6) return name;
    return `${chars.slice(0, 6).join("")}…`;
  }
  return chars.slice(0, 5).join("");
}

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function moveClocks(previous) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const known = new Set(previous.map((item) => item.id));
  for (const item of previous) {
    if (item.id === "empty") continue;
    const element = board.querySelector(`.clock[data-id="${CSS.escape(item.id)}"]`);
    if (!element) continue;
    const next = element.getBoundingClientRect();
    const dx = item.box.left - next.left;
    const dy = item.box.top - next.top;
    const scale = next.width ? item.box.width / next.width : 1;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(scale - 1) < 0.03) continue;
    element.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: "none" }],
      { duration: 340, easing: "cubic-bezier(.2,.7,.2,1)" }
    );
  }
  board.querySelectorAll(".clock").forEach((element) => {
    if (known.has(element.dataset.id) || element.dataset.empty) return;
    element.animate(
      [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }],
      { duration: 280, easing: "ease-out" }
    );
  });
}

function paintAlarmChrome(alarm = { playingId: null, waitingIds: [], blocked: false, failed: false }) {
  const playing = state.timers.find((timer) => timer.id === alarm.playingId);
  muteBtn.hidden = !(playing && soundUrl(state.settings.soundId));
}

function receiveFiles(files) {
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (!images.length) return;
  readGeneration += 1;
  const generation = readGeneration;
  if (state.sheet) closeSheet();
  const extra = images.length > MAX_TIMERS ? `一次最多 ${MAX_TIMERS} 張，已取前面 ${MAX_TIMERS} 張。` : "";
  const now = new Date();
  const drafts = images.slice(0, MAX_TIMERS).map((file) => ({
    localId: crypto.randomUUID(),
    file,
    location: "",
    hours: 0,
    minutes: 0,
    seconds: 0,
    anchorDate: toDateInput(now),
    anchorTime: toTimeInput(now),
    anchorSeconds: now.getSeconds(),
    usedNow: true,
    kind: "",
    remainingReady: false,
    clockReady: false,
    locationDirty: false,
    remainingDirty: false,
    anchorDirty: false
  }));
  state.reading = "正在讀取截圖…";
  paintReading();
  readDrafts(drafts, generation, extra);
}

async function readDrafts(drafts, generation, extra) {
  for (let index = 0; index < drafts.length; index += 1) {
    if (generation !== readGeneration) return;
    const draft = drafts[index];
    state.reading = `正在讀取第 ${index + 1} 張，共 ${drafts.length} 張`;
    paintReading();
    try {
      const reading = await recognizeScreenshot(draft.file);
      if (generation !== readGeneration) return;
      applyReading(draft, reading, new Date());
    } catch (error) {
      console.warn(error);
      if (generation !== readGeneration) return;
    }
  }
  if (generation !== readGeneration) return;
  const placed = nextTimers(
    state.timers,
    drafts,
    cooldownDuration(state.settings),
    Date.now(),
    () => crypto.randomUUID()
  );
  state.timers = placed.timers;
  saveState(state);
  state.reading = null;
  paintReading();
  paintBoard(Date.now(), true);
  alarms.setOrder(playableOrder(Date.now()));
  if (placed.dropped) showNotice(`已經有 ${MAX_TIMERS} 顆鬧鐘，多出來的沒有放上去。請先刪掉一顆再上傳。`);
  else if (extra) showNotice(extra);
}

function paintReading() {
  readout.hidden = !state.reading;
  if (state.reading) setText(readout, state.reading);
}

function showNotice(text) {
  window.clearTimeout(noticeTimer);
  state.reading = text;
  paintReading();
  noticeTimer = window.setTimeout(() => {
    if (state.reading !== text) return;
    state.reading = null;
    paintReading();
  }, 4500);
}

function openSettings() {
  state.sheet = { type: "settings" };
  renderSheet();
}

function openEdit(id) {
  const timer = state.timers.find((item) => item.id === id);
  if (!timer) return;
  const parts = Number.isFinite(timer.respawnAt)
    ? splitRemaining(Math.max(0, timer.respawnAt - Date.now()))
    : { hours: "", minutes: "", seconds: "" };
  state.sheet = {
    type: "edit",
    id,
    location: timer.location,
    hours: parts.hours,
    minutes: parts.minutes,
    seconds: parts.seconds,
    armed: false,
    error: ""
  };
  renderSheet();
}

function splitRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    hours: String(Math.floor(total / 3600)),
    minutes: String(Math.floor((total % 3600) / 60)),
    seconds: String(total % 60)
  };
}

function closeSheet() {
  state.sheet = null;
  sheet.hidden = true;
  panel.innerHTML = "";
  document.body.classList.remove("sheet-open");
  alarms.stopPreview();
}

function renderSheet() {
  const view = state.sheet;
  sheet.hidden = false;
  document.body.classList.add("sheet-open");
  if (view.type === "settings") panel.innerHTML = settingsMarkup();
  if (view.type === "edit") panel.innerHTML = editMarkup();
  const title = panel.querySelector("#sheetTitle");
  if (title) panel.setAttribute("aria-label", title.textContent);
  if (view.type === "edit") paintEditLive();
}

function settingsMarkup() {
  const { settings } = state;
  const floors = FLOORS.map((floor) => `
    <button type="button" class="floor-btn" data-action="floor" data-floor="${floor.id}" aria-pressed="${floor.id === settings.floorId}" aria-label="${floor.label}">
      <img src="${floorThumbUrl(floor.id)}" alt="">
      <span>${floor.label}</span>
    </button>`).join("");
  const sounds = SOUNDS.map((sound) => {
    const name = sound.label.replace(/\.mp3$/i, "");
    const selected = sound.id === settings.soundId ? "selected" : "";
    return `<option value="${escapeAttr(sound.id)}" ${selected}>${escapeAttr(name)}</option>`;
  }).join("");
  const minuteOptions = Array.from({ length: 6 }, (_, minute) => {
    const selected = minute === settings.cooldownMin ? "selected" : "";
    return `<option value="${minute}" ${selected}>${minute} 分</option>`;
  }).join("");
  const secondOptions = Array.from({ length: 31 }, (_, second) => {
    const selected = second === settings.cooldownSec ? "selected" : "";
    return `<option value="${second}" ${selected}>${second} 秒</option>`;
  }).join("");
  const idleOptions = Array.from({ length: 10 }, (_, index) => {
    const minute = index + 1;
    const selected = minute === settings.dimIdleMin ? "selected" : "";
    return `<option value="${minute}" ${selected}>${minute} 分鐘</option>`;
  }).join("");
  const secondsLocked = settings.cooldownMin === 5;
  const previewLocked = settings.soundId === "mute" || Boolean(alarms.playingId());
  const wakeHint = "wakeLock" in navigator
    ? "幾分鐘沒有點螢幕，就蓋上黑畫面，只留深綠色倒數。這個頁面在前景時會保持亮著。"
    : "幾分鐘沒有點螢幕，就蓋上黑畫面，只留深綠色倒數。這台瀏覽器可能無法阻止螢幕自己關掉。";
  return `
    <div class="sheet-head"><h2 id="sheetTitle">設定</h2><button type="button" data-action="close">完成</button></div>
    <div class="settings-body">
    <p class="section-label">背景</p>
    <div class="floor-row">${floors}</div>
    <p class="section-label">響鈴</p>
    <p class="hint">所有鬧鐘共用你選的這一種。</p>
    <div class="setting-row">
      <select id="soundSelect" aria-label="響鈴">${sounds}</select>
      <button type="button" id="previewSound" data-action="preview" ${previewLocked ? "disabled" : ""}>試聽</button>
    </div>
    <p class="section-label">冷卻時間</p>
    <div class="setting-row">
      <select id="coolMin" aria-label="冷卻分鐘">${minuteOptions}</select>
      <select id="coolSec" aria-label="冷卻秒數" ${secondsLocked ? "disabled" : ""}>${secondOptions}</select>
    </div>
    <p class="hint">加在蘑菇消滅剩餘時間後面。已經在倒數的鬧鐘不會改。5 分鐘時秒數固定為 0。</p>
    <p class="section-label">節能模式啟動時間</p>
    <div class="setting-row">
      <select id="dimIdleMin" aria-label="節能模式啟動時間">${idleOptions}</select>
    </div>
    <p class="hint">${wakeHint}</p>
    <label class="switch-row">
      <span><span class="sound-name">工作模式</span><span class="hint">倒數進行中，點文字會調整鬧鐘。點文字以外的畫面會蓋上工作圖片。再點一下就回來。</span></span>
      <input id="workMode" type="checkbox" ${settings.workMode ? "checked" : ""}>
    </label>
    </div>`;
}

function editMarkup() {
  const view = state.sheet;
  return `
    <div class="sheet-head"><h2 id="sheetTitle">調整鬧鐘</h2><button type="button" data-action="close">取消</button></div>
    <label class="field">地點<input data-field="location" value="${escapeAttr(view.location)}" autocomplete="off" placeholder="地點"></label>
    <p class="section-label">剩餘時間</p>
    <div class="remain-row">
      <label>時<input data-field="hours" inputmode="numeric" value="${escapeAttr(view.hours)}"></label>
      <label>分<input data-field="minutes" inputmode="numeric" value="${escapeAttr(view.minutes)}"></label>
      <label>秒<input data-field="seconds" inputmode="numeric" value="${escapeAttr(view.seconds)}"></label>
    </div>
    <p class="preview" data-part="remain"></p>
    <p class="slot-note warn" data-part="error"></p>
    <div class="edit-actions">
      <button type="button" class="danger" data-action="delete-edit">刪除</button>
      <button type="button" class="done" data-action="save-edit">完成</button>
    </div>`;
}

function paintEditLive() {
  const view = state.sheet;
  if (view?.type !== "edit") return;
  const duration = durationFrom(view);
  const line = panel.querySelector("[data-part=remain]");
  if (line) {
    if (duration == null) setText(line, "還沒有剩餘時間，鬧鐘上會顯示問號。");
    else if (duration === 0) setText(line, "這個時間已到，完成後會立刻響鈴。");
    else setText(line, `還剩 ${formatCountdown(duration)}，結束 ${formatClock(new Date(Date.now() + duration))}`);
  }
  setText(panel.querySelector("[data-part=error]"), view.error || "");
}

function durationFrom(view) {
  const fields = [view.hours, view.minutes, view.seconds].map((value) => String(value ?? "").trim());
  if (fields.every((value) => value === "")) return null;
  const [hours, minutes, seconds] = fields.map((value, index) => {
    const max = index === 0 ? 99 : 59;
    const number = Number.parseInt(value || "0", 10);
    if (!Number.isFinite(number) || number < 0) return 0;
    return Math.min(max, number);
  });
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

function onSheetClick(event) {
  event.stopPropagation();
  if (event.target === sheet) {
    closeSheet();
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button || !state.sheet) return;
  const action = button.dataset.action;
  if (action === "close") closeSheet();
  if (action === "floor") chooseFloor(button.dataset.floor);
  if (action === "preview") {
    if (button.disabled || alarms.playingId()) return;
    const url = soundUrl(state.settings.soundId);
    if (url) alarms.preview(url)?.catch(() => {});
  }
  if (action === "save-edit") saveEdit();
  if (action === "delete-edit") deleteEdit(button);
}

function onSheetInput(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !state.sheet) return;
  if (state.sheet.type === "edit") updateEditField(input);
}

function onSheetChange(event) {
  const input = event.target;
  if (!state.sheet) return;
  if (input instanceof HTMLSelectElement) {
    if (input.id === "soundSelect") {
      state.settings.soundId = input.value;
      saveState(state);
      alarms.stopPreview();
      paintPreviewButton();
    }
    if (input.id === "coolMin" || input.id === "coolSec") {
      const next = clampCooldown(
        input.id === "coolMin" ? input.value : state.settings.cooldownMin,
        input.id === "coolSec" ? input.value : state.settings.cooldownSec
      );
      state.settings.cooldownMin = next.cooldownMin;
      state.settings.cooldownSec = next.cooldownSec;
      saveState(state);
      paintCooldown();
    }
    if (input.id === "dimIdleMin") {
      state.settings.dimIdleMin = clampDimIdle(input.value);
      saveState(state);
    }
    return;
  }
  if (!(input instanceof HTMLInputElement)) return;
  if (input.id === "workMode") {
    state.settings.workMode = input.checked;
    saveState(state);
    if (!input.checked) hideWorkCover();
  }
  if (state.sheet.type === "edit") updateEditField(input);
}

function chooseFloor(id) {
  if (!FLOORS.some((floor) => floor.id === id)) return;
  state.settings.floorId = id;
  app.style.backgroundImage = `url("${floorUrl(id)}")`;
  saveState(state);
  panel.querySelectorAll("[data-floor]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.floor === id));
  });
}

function paintCooldown() {
  const minutes = panel.querySelector("#coolMin");
  const seconds = panel.querySelector("#coolSec");
  if (!minutes || !seconds) return;
  minutes.value = String(state.settings.cooldownMin);
  seconds.value = String(state.settings.cooldownSec);
  seconds.disabled = state.settings.cooldownMin === 5;
}

function paintPreviewButton() {
  const button = panel.querySelector("#previewSound");
  if (!button) return;
  button.disabled = state.settings.soundId === "mute" || Boolean(alarms.playingId());
}

function updateEditField(input) {
  const view = state.sheet;
  if (view.type !== "edit") return;
  view.error = "";
  view.armed = false;
  const field = input.dataset.field;
  if (field === "location") view.location = input.value;
  if (field === "hours" || field === "minutes" || field === "seconds") {
    const digits = input.value.replace(/\D/g, "").slice(0, 2);
    view[field] = digits;
    if (input.value !== digits) input.value = digits;
  }
  const again = panel.querySelector("[data-action=delete-edit]");
  if (again) again.textContent = "刪除";
  paintEditLive();
}

function saveEdit() {
  const view = state.sheet;
  if (view?.type !== "edit") return;
  const location = view.location.trim();
  if (location && state.timers.some((timer) => timer.id !== view.id && timer.location.trim() === location)) {
    view.error = "已有這個地點。";
    paintEditLive();
    return;
  }
  const timer = state.timers.find((item) => item.id === view.id);
  if (!timer) {
    closeSheet();
    return;
  }
  const duration = durationFrom(view);
  timer.location = location;
  timer.respawnAt = duration == null ? null : Date.now() + duration;
  saveState(state);
  closeSheet();
  paintBoard(Date.now(), true);
  alarms.setOrder(playableOrder(Date.now()));
}

function deleteEdit(button) {
  const view = state.sheet;
  if (view?.type !== "edit") return;
  if (!view.armed) {
    view.armed = true;
    button.textContent = "再按一次";
    return;
  }
  state.timers = state.timers.filter((timer) => timer.id !== view.id);
  saveState(state);
  closeSheet();
  paintBoard(Date.now(), true);
  alarms.setOrder(playableOrder(Date.now()));
}

let wakeSentinel = null;
let wakeFailed = false;
let wakePending = false;

async function syncWakeLock() {
  const want = document.visibilityState === "visible";
  if (!want) {
    if (wakeSentinel) {
      const current = wakeSentinel;
      wakeSentinel = null;
      current.release().catch(() => {});
    }
    return;
  }
  if (wakeSentinel || wakeFailed || wakePending || !navigator.wakeLock) return;
  wakePending = true;
  try {
    const sentinel = await navigator.wakeLock.request("screen");
    if (document.visibilityState !== "visible") {
      sentinel.release().catch(() => {});
      return;
    }
    wakeSentinel = sentinel;
    sentinel.addEventListener("release", () => {
      if (wakeSentinel === sentinel) wakeSentinel = null;
    });
  } catch {
    wakeFailed = true;
    wakeSentinel = null;
  } finally {
    wakePending = false;
  }
}

syncWakeLock();

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

