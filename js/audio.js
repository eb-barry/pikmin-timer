import { ALARM_MS } from "./time.js";

export function createAlarms({ getSoundUrl, onDone, onChange }) {
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
    state.current.audio.pause();
    state.current.audio.src = "";
    state.current = null;
  };

  const start = (id) => {
    if (!id || state.current) return;
    stopPreview();
    const audio = new Audio(getSoundUrl());
    audio.loop = true;
    audio.preload = "auto";
    const timer = setTimeout(() => finish(id), ALARM_MS);
    state.current = { id, audio, timer, startedAt: Date.now() };
    state.blocked = false;
    state.failed = false;
    emit();
    audio.play().catch((error) => {
      if (!state.current || state.current.id !== id) return;
      clearTimeout(state.current.timer);
      state.current.audio.pause();
      state.current = null;
      state.blocked = error?.name === "NotAllowedError";
      state.failed = !state.blocked;
      emit();
    });
  };

  const finish = (id) => {
    if (!state.current || state.current.id !== id) return;
    clearCurrent();
    onDone(id);
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
    playFromGesture() {
      state.blocked = false;
      state.failed = false;
      if (!state.current) start(state.order[0]);
    },
    preview(url) {
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
    checkElapsed() {
      if (state.current && Date.now() - state.current.startedAt >= ALARM_MS) {
        finish(state.current.id);
      }
    }
  };
}

export function unlockAudio(url) {
  const audio = new Audio(url);
  audio.volume = 0.001;
  audio.play()?.then(() => {
    audio.pause();
    audio.src = "";
  }).catch(() => {});
}
