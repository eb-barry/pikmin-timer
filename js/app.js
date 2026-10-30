import { clockButton } from "./clock.js";
import { FLOORS, SOUNDS, floorThumbUrl, floorUrl, soundUrl } from "./catalog.js";
import { createAlarms, unlockAudio } from "./audio.js";
import { recognizeScreenshot } from "./ocr.js";
import { loadState, saveState } from "./store.js";
import {
  alarmOrder,
  applyReading,
  canStart,
  classifyDrafts,
  describeDraft,
  draftToRespawn,
  formatClock,
  formatCountdown,
  MAX_TIMERS,
  meridiemLabel,
  shiftAnchor,
  splitBoard,
  toDateInput,
  toTimeInput,
  toggleMeridiem,
  WAKE_WINDOW_MS
} from "./time.js";

const loaded = loadState();
const state = {
  settings: loaded.settings,
  timers: loaded.timers,
  sheet: null,
  layoutSig: ""
};

const app = document.getElementById("app");
const board = document.getElementById("board");
const sheet = document.getElementById("sheet");
const panel = sheet.querySelector(".sheet-panel");
const fileInput = document.getElementById("fileInput");
const muteBtn = document.getElementById("muteBtn");
const gesture = document.getElementById("gestureHint");

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
document.getElementById("playHint").addEventListener("click", () => alarms.playFromGesture());
document.getElementById("dismissHint").addEventListener("click", () => alarms.dismissHead());
fileInput.addEventListener("change", () => {
  const files = [...fileInput.files];
  fileInput.value = "";
  if (files.length) receiveFiles(files);
});
board.addEventListener("click", (event) => {
  const clock = event.target.closest(".clock");
  if (!clock) return;
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
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") tick();
});

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
  paintConfirmLive();
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
  const remaining = timer.respawnAt - now;
  const ringing = remaining <= 0;
  element.classList.toggle("is-live", true);
  element.classList.toggle("is-ringing", ringing);
  element.classList.toggle("is-soon", !ringing && remaining < 60000);
  const digits = ringing ? "00:00:00" : formatCountdown(remaining);
  const end = ringing ? "重生了" : formatClock(new Date(timer.respawnAt), { seconds: size === "lg" });
  setText(element.querySelector("[data-part=digits]"), digits);
  setText(element.querySelector("[data-part=end]"), end);
  setText(element.querySelector("[data-part=place]"), timer.location);
  element.setAttribute("aria-label", ringing
    ? `${timer.location}，時間到，已重生`
    : `${timer.location}，還剩 ${digits}，重生 ${end}`);
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
    setText(muteBtn.querySelector("[data-part=name]"), playing.location);
    const more = muteBtn.querySelector("[data-part=more]");
    more.hidden = alarm.waitingIds.length === 0;
    setText(more, `還有 ${alarm.waitingIds.length}`);
  }
  const headId = alarm.playingId || alarm.waitingIds[0];
  const head = state.timers.find((timer) => timer.id === headId);
  const showHint = Boolean(head) && (alarm.blocked || alarm.failed) && !alarm.playingId;
  gesture.hidden = !showHint;
  if (showHint) {
    const reason = alarm.failed ? "這段響鈴沒有播放出來" : "點一下播放重生提示";
    setText(gesture.querySelector("[data-part=text]"), `${head.location}：${reason}`);
  }
}

function receiveFiles(files) {
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (!images.length) return;
  const extra = images.length > MAX_TIMERS ? "一次最多 6 張，已取前面 6 張。" : "";
  const now = new Date();
  const drafts = images.slice(0, MAX_TIMERS).map((file) => ({
    localId: crypto.randomUUID(),
    file,
    previewUrl: URL.createObjectURL(file),
    location: "",
    hours: 0,
    minutes: 0,
    seconds: 0,
    anchorDate: toDateInput(now),
    anchorTime: toTimeInput(now),
    anchorSeconds: now.getSeconds(),
    usedNow: true,
    remainingReady: false,
    locationDirty: false,
    remainingDirty: false,
    anchorDirty: false,
    ocrNote: "正在讀取…"
  }));
  openConfirm(drafts, extra);
  readDrafts(drafts);
}

async function readDrafts(drafts) {
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index];
    if (!draftStillOpen(draft)) return;
    draft.ocrNote = `正在讀取第 ${index + 1} 張，共 ${drafts.length} 張`;
    paintConfirmLive();
    try {
      const reading = await recognizeScreenshot(draft.file);
      if (!draftStillOpen(draft)) return;
      applyReading(draft, reading, new Date());
      const missing = [];
      if (!draft.location) missing.push("地點");
      if (!draft.remainingReady) missing.push("消滅時間");
      draft.ocrNote = missing.length ? `請補上${missing.join("、")}` : "已讀到截圖，請再看一眼";
      fillDraftFields(draft);
    } catch (error) {
      console.warn(error);
      if (!draftStillOpen(draft)) return;
      draft.ocrNote = "讀取失敗，請對照截圖填入";
    }
    paintConfirmLive();
  }
}

function draftStillOpen(draft) {
  return state.sheet?.type === "confirm" && state.sheet.drafts.includes(draft);
}

function openConfirm(drafts, extraNote) {
  revokeDrafts();
  state.sheet = { type: "confirm", drafts, extraNote, pendingRemove: new Set() };
  renderSheet();
}

function openSettings() {
  revokeDrafts();
  state.sheet = { type: "settings" };
  renderSheet();
}

function openEdit(id) {
  const timer = state.timers.find((item) => item.id === id);
  if (!timer) return;
  revokeDrafts();
  state.sheet = {
    type: "edit",
    id,
    location: timer.location,
    respawnAt: timer.respawnAt,
    armed: false,
    error: ""
  };
  renderSheet();
}

function closeSheet() {
  revokeDrafts();
  state.sheet = null;
  sheet.hidden = true;
  panel.innerHTML = "";
  document.body.classList.remove("sheet-open");
  alarms.stopPreview();
}

function revokeDrafts() {
  for (const draft of state.sheet?.drafts || []) URL.revokeObjectURL(draft.previewUrl);
}

function renderSheet() {
  const view = state.sheet;
  sheet.hidden = false;
  document.body.classList.add("sheet-open");
  if (view.type === "settings") panel.innerHTML = settingsMarkup();
  if (view.type === "confirm") panel.innerHTML = confirmMarkup();
  if (view.type === "edit") panel.innerHTML = editMarkup();
  const title = panel.querySelector("#sheetTitle");
  if (title) panel.setAttribute("aria-label", title.textContent);
  if (view.type === "confirm") {
    paintConfirmLive();
    alignShots();
  }
  if (view.type === "edit") paintEditLive();
}

function alignShots() {
  panel.querySelectorAll(".shot-wrap").forEach((wrap) => {
    const img = wrap.querySelector("img");
    if (!img) return;
    const place = () => {
      const shown = img.getBoundingClientRect().height;
      if (!shown) return;
      wrap.scrollTop = Math.max(0, shown * 0.44 - wrap.clientHeight * 0.15);
    };
    if (img.complete && img.naturalHeight) place();
    else img.addEventListener("load", place, { once: true });
  });
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
      <span class="sound-copy"><span class="sound-name">${sound.label}</span><span class="sound-file">${sound.file}</span></span>
      <button type="button" class="mini" data-action="preview" data-sound="${sound.id}">試聽</button>
    </label>`).join("");
  return `
    <div class="sheet-head"><h2 id="sheetTitle">設定</h2><button type="button" data-action="close">完成</button></div>
    <p class="section-label">地板</p>
    <div class="floor-row">${floors}</div>
    <p class="section-label">響鈴</p>
    <p class="hint">六個鬧鐘共用這一種。之後用同名 MP3 覆蓋 beep1 到 beep6，這裡就會換成新的聲音。</p>
    ${sounds}
    <p class="section-label">冷卻</p>
    <div class="stepper">
      <button type="button" data-action="cool" data-delta="-1" aria-label="減少冷卻">−</button>
      <strong data-part="cool">${settings.cooldownMin} 分鐘</strong>
      <button type="button" data-action="cool" data-delta="1" aria-label="增加冷卻">+</button>
    </div>
    <p class="hint">加在蘑菇消滅剩餘時間後面。已經在倒數的鬧鐘不會改。</p>
    <label class="switch-row">
      <span><span class="sound-name">最後 5 分鐘保持螢幕亮著</span><span class="hint">${"wakeLock" in navigator ? "只有最近的一顆少於 5 分鐘時才會亮。" : "這台瀏覽器可能無法保持亮螢幕。"}</span></span>
      <input id="keepAwake" type="checkbox" ${settings.keepAwake ? "checked" : ""}>
    </label>`;
}

function confirmMarkup() {
  const view = state.sheet;
  const cards = view.drafts.map((draft) => `
    <article class="card" data-draft="${draft.localId}">
      <div class="shot-wrap"><img class="shot" src="${draft.previewUrl}" alt="蘑菇截圖，可捲動核對"></div>
      <p class="status" data-part="status"></p>
      <label class="field">地點<input data-field="location" value="${escapeAttr(draft.location)}" autocomplete="off"></label>
      <div class="remain-row">
        <label>時<input data-field="hours" inputmode="numeric" value="${draft.hours}"></label>
        <label>分<input data-field="minutes" inputmode="numeric" value="${draft.minutes}"></label>
        <label>秒<input data-field="seconds" inputmode="numeric" value="${draft.seconds}"></label>
      </div>
      <label class="field">截圖日期<input data-field="date" type="date" value="${draft.anchorDate}"></label>
      <label class="field">截圖時間<input data-field="time" type="time" value="${draft.anchorTime}"></label>
      <div class="inline-actions">
        <button type="button" class="mini" data-action="now">用手機現在</button>
        <button type="button" class="mini" data-action="meridiem">${meridiemLabel(draft.anchorTime)}</button>
        <button type="button" class="mini" data-action="shift" data-delta="-1">早 1 分</button>
        <button type="button" class="mini" data-action="shift" data-delta="1">晚 1 分</button>
      </div>
      <p class="preview" data-part="preview"></p>
      <p class="slot-note" data-part="slot"></p>
      <div class="inline-actions"><button type="button" class="ghost" data-action="remove-draft">移除此張</button></div>
    </article>`).join("");
  const existing = state.timers.map((timer) => `
    <div class="remove-row" data-existing="${timer.id}">
      <span>${escapeText(timer.location)}</span>
      <button type="button" class="mini" data-action="queue-remove">開始後移掉</button>
    </div>`).join("");
  return `
    <div class="sheet-head"><h2 id="sheetTitle">確認重生時間</h2><button type="button" data-action="close">取消</button></div>
    <p class="lead">消滅剩餘時間會再加 <span data-part="cool-note">${state.settings.cooldownMin}</span> 分鐘冷卻。地點用截圖上方的公園名。</p>
    ${view.extraNote ? `<p class="slot-note warn">${escapeText(view.extraNote)}</p>` : ""}
    <p class="slot-note" data-part="capacity"></p>
    <div data-part="existing" ${state.timers.length ? "" : "hidden"}>${existing}</div>
    ${cards}
    <div class="sheet-foot"><button type="button" class="primary" data-action="start" disabled>開始倒數</button></div>`;
}

function editMarkup() {
  const view = state.sheet;
  const when = new Date(view.respawnAt);
  return `
    <div class="sheet-head"><h2 id="sheetTitle">調整鬧鐘</h2><button type="button" data-action="close">取消</button></div>
    <label class="field">地點<input data-field="location" value="${escapeAttr(view.location)}" autocomplete="off"></label>
    <label class="field">重生日期<input data-field="date" type="date" value="${toDateInput(when)}"></label>
    <label class="field">重生時間<input data-field="time" type="time" value="${toTimeInput(when)}"></label>
    <div class="inline-actions">
      <button type="button" class="mini" data-action="shift-edit" data-delta="-1">提前 1 分</button>
      <button type="button" class="mini" data-action="shift-edit" data-delta="1">延後 1 分</button>
    </div>
    <p class="preview" data-part="remain"></p>
    <p class="slot-note warn" data-part="error"></p>
    <div class="inline-actions">
      <button type="button" class="primary" data-action="save-edit">完成</button>
      <button type="button" class="danger" data-action="delete-edit">刪除這顆</button>
    </div>`;
}

function paintConfirmLive() {
  const view = state.sheet;
  if (view?.type !== "confirm") return;
  const now = new Date();
  const cooldownMs = state.settings.cooldownMin * 60 * 1000;
  const activeExisting = state.timers.filter((timer) => !view.pendingRemove.has(timer.id));
  const classified = classifyDrafts(activeExisting, view.drafts);
  view.drafts.forEach((draft, index) => {
    const card = panel.querySelector(`[data-draft="${CSS.escape(draft.localId)}"]`);
    if (!card) return;
    setText(card.querySelector("[data-part=status]"), draft.ocrNote);
    const described = describeDraft(draft, cooldownMs, now);
    const preview = card.querySelector("[data-part=preview]");
    if (!draft.remainingReady) {
      setText(preview, `會加上 ${state.settings.cooldownMin} 分鐘冷卻。請先填消滅剩餘時間。`);
    } else if (described?.past) {
      setText(preview, `重生時間 ${described.respawnText} 已過，開始後會立刻響鈴。`);
    } else if (described) {
      const taken = draft.usedNow ? "截圖很接近現在，秒數用手機時間。" : "";
      setText(preview, `重生 ${described.respawnText}，從現在起 ${described.countdownText}。${taken}`);
    }
    const note = classified.notes[index];
    const slot = card.querySelector("[data-part=slot]");
    slot.classList.toggle("warn", note === "duplicate-lost" || note === "need-location");
    setText(slot, slotMessage(note));
    const meridiem = card.querySelector("[data-action=meridiem]");
    if (meridiem) setText(meridiem, meridiemLabel(draft.anchorTime));
  });
  const capacity = panel.querySelector("[data-part=capacity]");
  if (capacity) {
    setText(capacity, classified.overflow
      ? `加上這次會有 ${classified.total} 顆，請把現有的鬧鐘標成移掉。最多 ${MAX_TIMERS} 顆。`
      : `加上這次共 ${classified.total} 顆。`);
  }
  const existing = panel.querySelector("[data-part=existing]");
  if (existing) existing.hidden = classified.overflow === 0;
  const start = panel.querySelector("[data-action=start]");
  if (start) {
    start.disabled = !canStart(classified, view.drafts);
    setText(start, `開始倒數（${view.drafts.length}）`);
  }
}

function slotMessage(note) {
  if (note === "replace") return "將取代正在倒數的同名地點。";
  if (note === "duplicate-lost") return "與另一張同一地點，請移除此張。";
  if (note === "need-location") return "請填地點。";
  return "";
}

function fillDraftFields(draft) {
  const card = panel.querySelector(`[data-draft="${CSS.escape(draft.localId)}"]`);
  if (!card) return;
  const assign = (field, value, dirty) => {
    const input = card.querySelector(`[data-field="${field}"]`);
    if (!input || dirty || document.activeElement === input) return;
    input.value = value;
  };
  assign("location", draft.location, draft.locationDirty);
  assign("hours", draft.hours, draft.remainingDirty);
  assign("minutes", draft.minutes, draft.remainingDirty);
  assign("seconds", draft.seconds, draft.remainingDirty);
  assign("date", draft.anchorDate, draft.anchorDirty);
  assign("time", draft.anchorTime, draft.anchorDirty);
}

function paintEditLive() {
  const view = state.sheet;
  if (view?.type !== "edit") return;
  const remaining = view.respawnAt - Date.now();
  const line = panel.querySelector("[data-part=remain]");
  if (line) {
    setText(line, remaining <= 0
      ? "這個時間已到，儲存後會立刻響鈴。"
      : `還剩 ${formatCountdown(remaining)}，重生 ${formatClock(new Date(view.respawnAt))}`);
  }
  const when = new Date(view.respawnAt);
  const date = panel.querySelector("[data-field=date]");
  const time = panel.querySelector("[data-field=time]");
  if (date && document.activeElement !== date) date.value = toDateInput(when);
  if (time && document.activeElement !== time) time.value = toTimeInput(when);
  setText(panel.querySelector("[data-part=error]"), view.error || "");
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
      alarms.preview(soundUrl(sound.id))?.catch(() => {});
    }
  }
  if (action === "cool") changeCooldown(Number(button.dataset.delta));
  if (action === "start") commitDrafts();
  if (action === "remove-draft") removeDraft(button);
  if (action === "now") useNow(button);
  if (action === "meridiem") flipMeridiem(button);
  if (action === "shift") shiftDraft(button, Number(button.dataset.delta));
  if (action === "queue-remove") togglePending(button);
  if (action === "shift-edit") shiftEdit(Number(button.dataset.delta));
  if (action === "save-edit") saveEdit();
  if (action === "delete-edit") deleteEdit(button);
}

function onSheetInput(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !state.sheet) return;
  if (state.sheet.type === "confirm") updateDraftField(input);
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
  if (state.sheet.type === "confirm") updateDraftField(input);
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

function changeCooldown(delta) {
  state.settings.cooldownMin = Math.min(30, Math.max(0, state.settings.cooldownMin + delta));
  saveState(state);
  setText(panel.querySelector("[data-part=cool]"), `${state.settings.cooldownMin} 分鐘`);
}

function draftFrom(button) {
  const card = button.closest("[data-draft]");
  return state.sheet?.drafts?.find((draft) => draft.localId === card?.dataset.draft) || null;
}

function updateDraftField(input) {
  const card = input.closest("[data-draft]");
  const draft = state.sheet.drafts.find((item) => item.localId === card?.dataset.draft);
  if (!draft) return;
  const field = input.dataset.field;
  if (field === "location") {
    draft.location = input.value;
    draft.locationDirty = true;
  }
  if (field === "hours" || field === "minutes" || field === "seconds") {
    const max = field === "hours" ? 99 : 59;
    const number = Math.min(max, Math.max(0, Number.parseInt(input.value || "0", 10) || 0));
    draft[field] = number;
    draft.remainingDirty = true;
    draft.remainingReady = true;
  }
  if (field === "date") {
    draft.anchorDate = input.value;
    draft.anchorDirty = true;
    draft.usedNow = false;
  }
  if (field === "time") {
    draft.anchorTime = input.value;
    draft.anchorSeconds = 0;
    draft.anchorDirty = true;
    draft.usedNow = false;
  }
  paintConfirmLive();
}

function useNow(button) {
  const draft = draftFrom(button);
  if (!draft) return;
  const now = new Date();
  draft.anchorDate = toDateInput(now);
  draft.anchorTime = toTimeInput(now);
  draft.anchorSeconds = now.getSeconds();
  draft.anchorDirty = true;
  draft.usedNow = true;
  fillDraftFields(draft);
  paintConfirmLive();
}

function flipMeridiem(button) {
  const draft = draftFrom(button);
  if (!draft) return;
  draft.anchorTime = toggleMeridiem(draft.anchorTime);
  draft.anchorDirty = true;
  draft.usedNow = false;
  fillDraftFields(draft);
  paintConfirmLive();
}

function shiftDraft(button, delta) {
  const draft = draftFrom(button);
  if (!draft) return;
  Object.assign(draft, shiftAnchor(draft.anchorDate, draft.anchorTime, draft.anchorSeconds, delta));
  draft.anchorDirty = true;
  draft.usedNow = false;
  fillDraftFields(draft);
  paintConfirmLive();
}

function removeDraft(button) {
  const draft = draftFrom(button);
  if (!draft || state.sheet.type !== "confirm") return;
  URL.revokeObjectURL(draft.previewUrl);
  state.sheet.drafts = state.sheet.drafts.filter((item) => item !== draft);
  if (!state.sheet.drafts.length) {
    closeSheet();
    return;
  }
  renderSheet();
}

function togglePending(button) {
  const row = button.closest("[data-existing]");
  const id = row?.dataset.existing;
  if (!id || state.sheet.type !== "confirm") return;
  if (state.sheet.pendingRemove.has(id)) {
    state.sheet.pendingRemove.delete(id);
    row.classList.remove("is-pending");
    button.textContent = "開始後移掉";
  } else {
    state.sheet.pendingRemove.add(id);
    row.classList.add("is-pending");
    button.textContent = "取消移掉";
  }
  paintConfirmLive();
}

function commitDrafts() {
  const view = state.sheet;
  if (view?.type !== "confirm") return;
  const cooldownMs = state.settings.cooldownMin * 60 * 1000;
  let timers = state.timers.filter((timer) => !view.pendingRemove.has(timer.id));
  const classified = classifyDrafts(timers, view.drafts);
  if (!canStart(classified, view.drafts)) return;
  view.drafts.forEach((draft, index) => {
    const note = classified.notes[index];
    if (note === "duplicate-lost" || note === "need-location") return;
    const respawn = draftToRespawn(draft, cooldownMs);
    if (!respawn) return;
    const location = draft.location.trim();
    timers = timers.filter((timer) => timer.location.trim() !== location);
    timers.push({
      id: crypto.randomUUID(),
      location,
      respawnAt: respawn.getTime(),
      createdAt: Date.now() + index
    });
  });
  state.timers = timers;
  saveState(state);
  closeSheet();
  paintBoard(Date.now(), true);
  alarms.setOrder(alarmOrder(state.timers, Date.now()));
}

function updateEditField(input) {
  const view = state.sheet;
  if (view.type !== "edit") return;
  view.error = "";
  if (input.dataset.field === "location") view.location = input.value;
  if (input.dataset.field === "date" || input.dataset.field === "time") {
    const date = panel.querySelector("[data-field=date]").value;
    const time = panel.querySelector("[data-field=time]").value;
    const seconds = new Date(view.respawnAt).getSeconds();
    const [year, month, day] = date.split("-").map(Number);
    const [hours, minutes] = time.split(":").map(Number);
    const next = new Date(year, month - 1, day, hours, minutes, seconds, 0);
    if (!Number.isNaN(next.getTime())) view.respawnAt = next.getTime();
  }
  paintEditLive();
}

function shiftEdit(delta) {
  if (state.sheet?.type !== "edit") return;
  state.sheet.respawnAt += delta * 60 * 1000;
  state.sheet.error = "";
  paintEditLive();
}

function saveEdit() {
  const view = state.sheet;
  if (view?.type !== "edit") return;
  const location = view.location.trim();
  if (!location) {
    view.error = "請填地點。";
    paintEditLive();
    return;
  }
  if (state.timers.some((timer) => timer.id !== view.id && timer.location.trim() === location)) {
    view.error = "已有這個地點。";
    paintEditLive();
    return;
  }
  const timer = state.timers.find((item) => item.id === view.id);
  if (!timer) {
    closeSheet();
    return;
  }
  timer.location = location;
  timer.respawnAt = view.respawnAt;
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
    button.textContent = "再按一次就刪除";
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
    .filter((timer) => timer.respawnAt > now)
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

function escapeText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
