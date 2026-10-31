const NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三"];

export const FLOORS = Array.from({ length: 13 }, (_, index) => {
  const id = `floor-${String(index + 1).padStart(2, "0")}`;
  return { id, label: `背景${NUMERALS[index]}`, file: `${id}.webp` };
});

export const SOUNDS = [
  ...["紅皮", "黃皮", "藍皮", "紫皮", "白皮", "岩石", "羽翅"].map((name) => ({
    id: name,
    label: `${name}.mp3`,
    file: `${name}.mp3`
  })),
  { id: "mute", label: "靜音", file: "" }
];

export function floorUrl(id) {
  return `assets/floors/${id}.webp`;
}

export function floorThumbUrl(id) {
  return `assets/floors/thumbs/${id}.webp`;
}

export function soundUrl(id) {
  if (!id || id === "mute") return "";
  return `assets/sounds/${encodeURIComponent(id)}.mp3`;
}
