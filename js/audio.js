import { ALARM_MS } from "./time.js";

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

let sharedAudio = null;
let sharedContext = null;

function outputElement() {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.setAttribute("playsinline", "");
    sharedAudio.setAttribute("webkit-playsinline", "");
    sharedAudio.preload = "auto";
  }
  return sharedAudio;
}

function outputContext() {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedContext) sharedContext = new Ctx();
  return sharedContext;
}

async function playThroughContext(url) {
  const ctx = outputContext();
  if (!ctx || ctx.state !== "running") throw new Error("blocked");
  const response = await fetch(url);
  const encoded = await response.arrayBuffer();
  const buffer = await ctx.decodeAudioData(encoded.slice(0));
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(ctx.destination);
  source.start();
  return source;
}

export function createAlarms({ getSoundUrl, onDone, onFinished = onDone, onChange }) {
  const state = {
    order: [],
    current: null,
    blocked: false,
    failed: false,
    preview: null
  };

  const emit = () => onChange({
    playingId: state.current?.id ?? null,
    waitingIds: state.order.filter((id) => id !== state.current?.id),
    blocked: state.blocked,
    failed: state.failed
  });

  const stopPreview = () => {
    if (!state.preview) return;
    state.preview.onended = null;
    state.preview.pause();
    state.preview.src = "";
    state.preview = null;
  };

  const clearCurrent = () => {
    if (!state.current) return;
    clearTimeout(state.current.timer);
    try { state.current.source?.stop(); } catch { /* already stopped */ }
    if (state.current.audio) state.current.audio.pause();
    state.current = null;
  };

  const giveUp = (id, error) => {
    if (!state.current || state.current.id !== id) return;
    clearTimeout(state.current.timer);
    state.current.audio?.pause();
    try { state.current.source?.stop(); } catch { /* already stopped */ }
    state.current = null;
    state.blocked = error?.name === "NotAllowedError" || error?.message === "blocked";
    state.failed = !state.blocked;
    emit();
  };

  const start = (id) => {
    if (!id || state.current) return;
    stopPreview();
    const url = getSoundUrl();
    const timer = setTimeout(() => finish(id), ALARM_MS);
    state.blocked = false;
    state.failed = false;
    if (!url) {
      state.current = { id, audio: null, source: null, timer, startedAt: Date.now() };
      emit();
      return;
    }
    const audio = outputElement();
    audio.pause();
    audio.muted = false;
    audio.volume = 1;
    audio.loop = true;
    audio.preload = "auto";
    audio.src = url;
    audio.currentTime = 0;
    state.current = { id, audio, source: null, timer, startedAt: Date.now() };
    emit();
    audio.play().catch(async (error) => {
      if (!state.current || state.current.id !== id) return;
      if (error?.name !== "NotAllowedError") {
        giveUp(id, error);
        return;
      }
      try {
        const source = await playThroughContext(url);
        if (!state.current || state.current.id !== id) {
          try { source.stop(); } catch { /* already stopped */ }
          return;
        }
        state.current.source = source;
        state.blocked = false;
        state.failed = false;
        emit();
      } catch {
        giveUp(id, error);
      }
    });
  };

  const finish = (id) => {
    if (!state.current || state.current.id !== id) return;
    clearCurrent();
    onFinished(id);
  };

  return {
    setOrder(ids) {
      const next = [...ids];
      const same = next.length === state.order.length && next.every((id, index) => id === state.order[index]);
      state.order = next;
      if (state.current && !state.order.includes(state.current.id)) clearCurrent();
      if (same && (state.current || state.blocked || state.failed || state.order.length === 0)) return;
      if (!state.current && state.order[0]) start(state.order[0]);
      else emit();
    },
    mute() {
      if (!state.current) return false;
      const id = state.current.id;
      clearCurrent();
      onDone(id);
      return true;
    },
    dismissHead() {
      if (state.current) {
        const id = state.current.id;
        clearCurrent();
        onDone(id);
        return true;
      }
      const id = state.order[0];
      if (!id) return false;
      onDone(id);
      return true;
    },
    needsGesture() {
      return (state.blocked || state.failed) && !state.current && state.order.length > 0;
    },
    playFromGesture() {
      state.blocked = false;
      state.failed = false;
      if (!state.current) start(state.order[0]);
    },
    preview(url) {
      if (!url) return Promise.resolve();
      const resume = state.current?.audio || null;
      if (resume) resume.pause();
      stopPreview();
      const audio = new Audio(url);
      state.preview = audio;
      audio.onended = () => {
        if (state.preview === audio) state.preview = null;
        if (resume && state.current?.audio === resume) resume.play().catch(() => {});
      };
      return audio.play();
    },
    stopPreview,
    playingId() {
      return state.current?.id ?? null;
    },
    checkElapsed() {
      if (state.current && Date.now() - state.current.startedAt >= ALARM_MS) {
        finish(state.current.id);
      }
    }
  };
}

export function unlockAudio(url) {
  const ctx = outputContext();
  if (ctx && ctx.state === "suspended") ctx.resume();
  if (ctx) {
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      node.start();
    } catch { /* a second gesture can prime it again */ }
  }
  const audio = outputElement();
  if (audio.dataset.primed === "1") return;
  audio.dataset.primed = "1";
  audio.volume = 0;
  audio.muted = true;
  if (!audio.getAttribute("src")) audio.src = url || SILENT_WAV;
  audio.play()?.then(() => {
    audio.pause();
    audio.muted = false;
    audio.volume = 1;
  }).catch(() => {
    delete audio.dataset.primed;
  });
}
