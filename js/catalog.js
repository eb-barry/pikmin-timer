export const FLOORS = Array.from({ length: 13 }, (_, index) => {
  const id = `floor-${String(index + 1).padStart(2, "0")}`;
  return { id, label: `地板 ${index + 1}`, file: `${id}.webp` };
});

export const SOUNDS = Array.from({ length: 6 }, (_, index) => {
  const id = `beep${index + 1}`;
  return { id, label: `響鈴 ${index + 1}`, file: `${id}.mp3` };
});

export function floorUrl(id) {
  return `assets/floors/${id}.webp`;
}

export function floorThumbUrl(id) {
  return `assets/floors/thumbs/${id}.webp`;
}

export function soundUrl(id) {
  return `assets/sounds/${id}.mp3`;
}
