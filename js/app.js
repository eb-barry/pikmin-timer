import { clockButton } from "./clock.js";
import { FLOORS, SOUNDS, floorThumbUrl, floorUrl, soundUrl } from "./catalog.js";
import { createAlarms, unlockAudio } from "./audio.js";
import { recognizeScreenshot } from "./ocr.js";
import { loadState, saveState } from "./store.js";
import {
  alarmOrder,
  applyReading,
  formatClock,
  formatCountdown,
  MAX_TIMERS,
  clampCooldown,
  cooldownDuration,
  nextTimers,
  splitBoard,
  toDateInput,
  toTimeInput,
  WAKE_WINDOW_MS
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
let readGeneration = 0;
let noticeTimer = 0;

app.style.backgroundImage = `url("${floorUrl(state.settings.floorId)}")`;

const alarms = createAlarms({
  getSoundUrl: () => soundUrl(state.settings.soundId),
  onDone: (id) => {
    state.timers = state.timers.filter((timer) => timer.id !== id);
    saveState(state);
    paintBoard(Date.now(), true);
    alarms.setOrder(alarmOrder(state.timers, Date.now()));
  },
  onChange: paintAlarmChrome
});

document.getElementById("uploadBtn").addEventListener("click", () => fileInput.click());
document.getElementById("settingsBtn").addEventListener("click", openSettings);
muteBtn.addEventListener("click", () => alarms.mute());
fileInput.addEventListener("change", () => {
  const files = [...fileInput.files];
  fileInput.value = "";
  if (files.length) receiveFiles(files);
});
board.addEventListener("click", (event) => {
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
document.addEventListener("pointerdown", () => {
  if (alarms.needsGesture()) alarms.playFromGesture();
});
document.addEventListener("click", onWorkCoverClick);
workCover.addEventListener("click", hideWorkCover);
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
  if (document.visibilityState === "visible") tick();
});

function onWorkCoverClick(event) {
  if (!state.settings.workMode || !state.timers.length || state.sheet || !workCover.hidden) return;
  if (event.target.closest(".clock, button, a, input, label, .sheet, .gesture")) return;
  workCover.hidden = false;
}

function hideWorkCover() {
  workCover.hidden = true;
}

paintBoard(Date.now(), true);
alarms.setOrder(alarmOrder(state.timers, Date.now()));
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

function tick() {
  const now = Date.now();
  alarms.checkElapsed();
  paintBoard(now);
  paintEditLive();
  alarms.setOrder(alarmOrder(state.timers, now));
  syncWakeLock(now);
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
  const endEl = element.querySelector("[data-part=end]");
  place.classList.toggle("missing", !named);
  setText(place, named || "?");
  if (!timed) {
    element.classList.add("is-live");
    element.classList.remove("is-ringing", "is-soon");
    digitsEl.classList.add("missing");
    endEl.classList.add("missing");
    setText(digitsEl, "?");
    setText(endEl, "?");
    element.setAttribute("aria-label", `${named || "地點未辨識"}，倒數未辨識`);
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
  element.setAttribute("aria-label", ringing
    ? `${named || "地點未辨識"}，時間到，已重生`
    : `${named || "地點未辨識"}，還剩 ${digits}，重生 ${end}`);
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
  muteBtn.hidden = !playing;
  if (playing) {
    setText(muteBtn.querySelector("[data-part=name]"), playing.location.trim() || "?");
    const more = muteBtn.querySelector("[data-part=more]");
    more.hidden = alarm.waitingIds.length === 0;
    setText(more, `還有 ${alarm.waitingIds.length}`);
  }
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
  alarms.setOrder(alarmOrder(state.timers, Date.now()));
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
  const sounds = SOUNDS.map((sound) => `
    <label class="sound-row">
      <input type="radio" name="sound" value="${sound.id}" ${sound.id === settings.soundId ? "checked" : ""}>
      <span class="sound-copy"><span class="sound-name">${sound.label}</span></span>
      ${sound.id === "mute" ? "" : `<button type="button" class="mini" data-action="preview" data-sound="${sound.id}">試聽</button>`}
    </label>`).join("");
  const secondsLocked = settings.cooldownMin === 5;
  return `
    <div class="sheet-head"><h2 id="sheetTitle">設定</h2><button type="button" data-action="close">完成</button></div>
    <p class="section-label">背景</p>
    <div class="floor-row">${floors}</div>
    <p class="section-label">響鈴</p>
    <p class="hint">所有鬧鐘共用你選的這一種。</p>
    ${sounds}
    <p class="section-label">冷卻時間</p>
    <div class="cool-grid">
      <div class="stepper">
        <button type="button" data-action="cool" data-unit="min" data-delta="-1" aria-label="減少分鐘">−</button>
        <strong data-part="cool-min">${settings.cooldownMin} 分</strong>
        <button type="button" data-action="cool" data-unit="min" data-delta="1" aria-label="增加分鐘">+</button>
      </div>
      <div class="stepper">
        <button type="button" data-action="cool" data-unit="sec" data-delta="-1" aria-label="減少秒數" ${secondsLocked ? "disabled" : ""}>−</button>
        <strong data-part="cool-sec">${settings.cooldownSec} 秒</strong>
        <button type="button" data-action="cool" data-unit="sec" data-delta="1" aria-label="增加秒數" ${secondsLocked ? "disabled" : ""}>+</button>
      </div>
    </div>
    <p class="hint">加在蘑菇消滅剩餘時間後面。已經在倒數的鬧鐘不會改。5 分鐘時秒數固定為 0。</p>
    <label class="switch-row">
      <span><span class="sound-name">工作模式</span><span class="hint">倒數進行中，點鬧鐘以外的畫面會蓋上工作畫面。再點一下就回來。</span></span>
      <input id="workMode" type="checkbox" ${settings.workMode ? "checked" : ""}>
    </label>
    <label class="switch-row">
      <span><span class="sound-name">最後 5 分鐘保持螢幕亮著</span><span class="hint">${"wakeLock" in navigator ? "只有最近的一顆少於 5 分鐘時才會亮。" : "這台瀏覽器可能無法保持亮螢幕。"}</span></span>
      <input id="keepAwake" type="checkbox" ${settings.keepAwake ? "checked" : ""}>
    </label>`;
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
    const sound = SOUNDS.find((item) => item.id === button.dataset.sound);
    if (sound) {
      state.settings.soundId = sound.id;
      saveState(state);
      const radio = panel.querySelector(`input[name="sound"][value="${sound.id}"]`);
      if (radio) radio.checked = true;
      const url = soundUrl(sound.id);
      if (url) alarms.preview(url)?.catch(() => {});
    }
  }
  if (action === "cool") changeCooldown(button.dataset.unit, Number(button.dataset.delta));
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
  if (!(input instanceof HTMLInputElement) || !state.sheet) return;
  if (input.name === "sound") {
    state.settings.soundId = input.value;
    saveState(state);
  }
  if (input.id === "keepAwake") {
    state.settings.keepAwake = input.checked;
    saveState(state);
    syncWakeLock(Date.now());
  }
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

function changeCooldown(unit, delta) {
  const next = clampCooldown(
    state.settings.cooldownMin + (unit === "min" ? delta : 0),
    state.settings.cooldownSec + (unit === "sec" ? delta : 0)
  );
  state.settings.cooldownMin = next.cooldownMin;
  state.settings.cooldownSec = next.cooldownSec;
  saveState(state);
  paintCooldown();
}

function paintCooldown() {
  setText(panel.querySelector("[data-part=cool-min]"), `${state.settings.cooldownMin} 分`);
  setText(panel.querySelector("[data-part=cool-sec]"), `${state.settings.cooldownSec} 秒`);
  const locked = state.settings.cooldownMin === 5;
  panel.querySelectorAll("[data-unit=sec]").forEach((button) => {
    button.disabled = locked;
  });
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
  alarms.setOrder(alarmOrder(state.timers, Date.now()));
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
  alarms.setOrder(alarmOrder(state.timers, Date.now()));
}

let wakeSentinel = null;

async function syncWakeLock(now) {
  const nearest = state.timers
    .filter((timer) => Number.isFinite(timer.respawnAt) && timer.respawnAt > now)
    .sort((a, b) => a.respawnAt - b.respawnAt)[0];
  const want = state.settings.keepAwake
    && document.visibilityState === "visible"
    && nearest
    && nearest.respawnAt - now <= WAKE_WINDOW_MS;
  if (want && !wakeSentinel && navigator.wakeLock) {
    try {
      wakeSentinel = await navigator.wakeLock.request("screen");
      wakeSentinel.addEventListener("release", () => { wakeSentinel = null; });
    } catch {
      wakeSentinel = null;
    }
  } else if (!want && wakeSentinel) {
    wakeSentinel.release().catch(() => {});
    wakeSentinel = null;
  }
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

