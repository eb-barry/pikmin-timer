export const FLOORS = Array.from({ length: 13 }, (_, index) => {
  const id = `floor-${String(index + 1).padStart(2, "0")}`;
  return { id, label: `地板 ${index + 1}`, file: `${id}.webp` };
});

export const SOUNDS = ["紅皮", "黃皮", "藍皮", "紫皮", "白皮", "岩石", "羽翅"].map((name) => ({
  id: name,
  label: `${name}.mp3`,
  file: `${name}.mp3`
}));

export function floorUrl(id) {
  return `assets/floors/${id}.webp`;
}

export function floorThumbUrl(id) {
  return `assets/floors/thumbs/${id}.webp`;
}

export function soundUrl(id) {
  return `assets/sounds/${encodeURIComponent(id)}.mp3`;
}
