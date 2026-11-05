import Tesseract from "../vendor/tesseract/tesseract.esm.min.js";
import { chooseRemainingRead, matchClock, readPlace } from "./parse.js";

const { createWorker } = Tesseract;

const workerPath = new URL("../vendor/tesseract/worker.min.js", import.meta.url).href;
const corePath = new URL("../vendor/tesseract/core", import.meta.url).href;
const langPath = new URL("../assets/tessdata", import.meta.url).href;

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("chi_tra+eng", 1, {
      workerPath,
      corePath,
      langPath
    }).then(async (worker) => {
      await worker.setParameters({ user_defined_dpi: "300" });
      return worker;
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

async function loadCanvas(source) {
  const bitmap = await createImageBitmap(source);
  const maxEdge = 2400;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

function crop(source, x, y, width, height, factor = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * factor));
  canvas.height = Math.max(1, Math.round(height * factor));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function recolor(canvas, keep) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const ink = keep(data[index], data[index + 1], data[index + 2]);
    const value = ink ? 0 : 255;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

async function readText(worker, canvas, mode, whitelist = "", dpi = 300) {
  await worker.setParameters({
    tessedit_pageseg_mode: mode,
    tessedit_char_whitelist: whitelist,
    user_defined_dpi: String(dpi)
  });
  const { data } = await worker.recognize(canvas);
  return data.text || "";
}

function isLightInk(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return red > 214 && green > 214 && blue > 200 && max - min < 48;
}

function darkInkAt(limit) {
  return (red, green, blue) => {
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    // Status type is nearly black. Dark green hedge and shadow sit just above
    // this and would fuse with the digits once the crop is enlarged.
    return max < limit && max - min < 14;
  };
}

function isDarkInk(red, green, blue) {
  return darkInkAt(48)(red, green, blue);
}

function isCountdownInk(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return red > 205 && green > 188 && blue > 170 && max - min < 55;
}

function isWhiteInk(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return red >= 226 && green >= 226 && blue >= 214 && max - min < 32;
}

function pad(canvas, amount = 28) {
  const next = document.createElement("canvas");
  next.width = canvas.width + amount * 2;
  next.height = canvas.height + amount * 2;
  const context = next.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, next.width, next.height);
  context.drawImage(canvas, amount, amount);
  return next;
}

function tightInk(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let any = false;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4] < 80) {
        any = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!any) return canvas;
  const margin = 20;
  const left = Math.max(0, minX - margin);
  const top = Math.max(0, minY - margin);
  return crop(
    canvas,
    left,
    top,
    Math.min(width - left, maxX - left + margin * 2),
    Math.min(height - top, maxY - top + margin * 2),
    1
  );
}

function copyCanvas(canvas) {
  const next = document.createElement("canvas");
  next.width = canvas.width;
  next.height = canvas.height;
  next.getContext("2d").drawImage(canvas, 0, 0);
  return next;
}

function inkCount(canvas) {
  const data = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] < 80) count += 1;
  }
  return count;
}

function scaleCanvas(canvas, factor, smooth = true) {
  if (factor <= 1) return canvas;
  const next = document.createElement("canvas");
  next.width = Math.max(1, Math.round(canvas.width * factor));
  next.height = Math.max(1, Math.round(canvas.height * factor));
  const context = next.getContext("2d");
  context.imageSmoothingEnabled = smooth;
  if (smooth) context.imageSmoothingQuality = "high";
  context.drawImage(canvas, 0, 0, next.width, next.height);
  return next;
}

function keepWidestRun(canvas, gapLimit = 22) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const columns = [];
  for (let x = 0; x < width; x += 1) {
    let ink = 0;
    for (let y = 0; y < height; y += 2) {
      if (data[(y * width + x) * 4] < 48) ink += 1;
    }
    columns.push(ink > 1);
  }
  const runs = [];
  let start = -1;
  let gap = 0;
  const close = (end) => {
    if (start < 0) return;
    runs.push({ start, end, width: end - start + 1 });
    start = -1;
  };
  columns.forEach((ink, x) => {
    if (ink) {
      if (start < 0) start = x;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap > gapLimit) close(x - gap);
    }
  });
  close(width - 1);
  if (!runs.length) return canvas;
  const best = runs.reduce((winner, run) => (run.width > winner.width ? run : winner));
  const margin = 10;
  const left = Math.max(0, best.start - margin);
  const cropWidth = Math.min(width - left, best.end - left + margin * 2);
  if (cropWidth >= width - 8) return canvas;
  return crop(canvas, left, 0, cropWidth, height, 1);
}

function textLine(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let ink = 0;
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4] < 80) ink += 1;
    }
    rows.push(ink);
  }
  const peak = rows.reduce((best, ink) => Math.max(best, ink), 0);
  if (peak < 8) return canvas;
  const gate = Math.max(8, peak * 0.28);
  let best = null;
  let start = -1;
  let total = 0;
  const close = (end) => {
    if (start < 0) return;
    if (!best || total > best.total) best = { start, end, total };
    start = -1;
    total = 0;
  };
  rows.forEach((ink, y) => {
    if (ink >= gate) {
      if (start < 0) start = y;
      total += ink;
    } else {
      close(y - 1);
    }
  });
  close(height - 1);
  if (!best) return canvas;
  const top = Math.max(0, best.start - 8);
  const bottom = Math.min(height, best.end + 9);
  return crop(canvas, 0, top, width, Math.max(1, bottom - top), 1);
}

function downsample(canvas, factor) {
  const next = document.createElement("canvas");
  next.width = Math.max(1, Math.round(canvas.width * factor));
  next.height = Math.max(1, Math.round(canvas.height * factor));
  const context = next.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(canvas, 0, 0, next.width, next.height);
  return next;
}

function enlargeLine(canvas, trim, useTextLine = true) {
  const prepared = useTextLine ? textLine(canvas) : canvas;
  const isolated = keepWidestRun(trim(tightInk(prepared)), 22);
  // Four-times enlargement cleans the tiny white strokes. Tesseract reads the smoother half-size copy.
  const big = pad(scaleCanvas(isolated, 4, true), 36);
  return { half: downsample(big, 0.5), big };
}

// Every slot is a fraction of the screenshot being read, so a taller or shorter phone
// uses the same layout. Measured on every game screen we have, the fractions match:
// place name 9.5%–11.2% of the height, hit points 42.2%–45.6%, countdown 45.9%–47.0%.
// The line height stays fixed. The width grows with the number of characters.
// A short line can sit only a few pixels from a daisy. Those flowers hang outside
// the glyph line, so they are dropped before the text is read. A gap wider than
// 4.5% of the screen still ends the box.
const CLOCK_BAND = { x: 0, y: 0, w: 0.28, h: 0.07 };
const PLACE_BAND = { x: 0.08, y: 0.088, w: 0.84, h: 0.04 };
const COUNTDOWN_BAND = { x: 0.012, y: 0.4568, w: 0.72, h: 0.0165 };

function fractionCrop(full, band) {
  return crop(
    full,
    full.width * band.x,
    full.height * band.y,
    full.width * band.w,
    full.height * band.h,
    1
  );
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function luminanceOf(red, green, blue) {
  return (red + green + blue) / 3;
}

// The place name is the white line inside the gray capsule. The capsule width grows
// with the name. A ">" sits at the end of that line and is not part of the name.
// Lights and flowers outside the capsule are ignored.
// A bright playground shows through a translucent pill, so the white type is no
// longer 50 above the whole column. The relaxed pass measures that type against
// the gray of the pill and ignores colorful flowers in the same column.
function densestRows(rows, window) {
  if (rows.length < 2) return rows;
  const sorted = [...rows].sort((left, right) => left - right);
  let best = [];
  let start = 0;
  for (let end = 0; end < sorted.length; end += 1) {
    while (sorted[start] < sorted[end] - window) start += 1;
    const chunk = sorted.slice(start, end + 1);
    if (chunk.length > best.length) best = chunk;
  }
  return best;
}

function readCapsule(band, relaxed) {
  const context = band.getContext("2d", { willReadFrequently: true });
  const { width, height } = band;
  const data = context.getImageData(0, 0, width, height).data;
  const at = (x, y) => (y * width + x) * 4;
  const background = [];
  for (let x = 0; x < width; x += 1) {
    const column = [];
    const gray = [];
    for (let y = 0; y < height; y += 1) {
      const pixel = at(x, y);
      const red = data[pixel];
      const green = data[pixel + 1];
      const blue = data[pixel + 2];
      const luminance = luminanceOf(red, green, blue);
      column.push(luminance);
      if (relaxed && Math.max(red, green, blue) - Math.min(red, green, blue) < 46) gray.push(luminance);
    }
    const sample = relaxed && gray.length >= Math.max(6, Math.floor(height * 0.22)) ? gray : column;
    background.push(percentile(sample, 0.35));
  }
  const smooth = background.map((_, x) => {
    const radius = 10;
    const slice = background.slice(Math.max(0, x - radius), Math.min(width, x + radius + 1));
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
  const columns = [];
  for (let x = 0; x < width; x += 1) {
    const rows = [];
    for (let y = 0; y < height; y += 1) {
      const pixel = at(x, y);
      const red = data[pixel];
      const green = data[pixel + 1];
      const blue = data[pixel + 2];
      const luminance = luminanceOf(red, green, blue);
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      const ink = relaxed
        ? luminance > smooth[x] + 16 && chroma < 36 && luminance > 188 && smooth[x] >= 50 && smooth[x] <= 226
        : luminance > smooth[x] + 50 && chroma < 42 && luminance > 165;
      if (ink) rows.push(y);
    }
    columns.push(rows);
  }
  const assembled = assembleCapsule(band, columns, smooth, at);
  if (!relaxed) return assembled;
  // Bright pixels above and below a translucent pill stretch a character to the
  // full band, and that line is then thrown out. Keep the plain mask when it
  // already holds the name, and use the focused line when it is much wider.
  const rowWindow = Math.max(8, Math.floor(height * 0.5));
  const focused = columns.map((rows) => densestRows(rows, rowWindow));
  const centers = focused.filter((rows) => rows.length >= 2).map((rows) => median(rows));
  if (!centers.length) return assembled;
  const line = median(centers);
  const limit = height * 0.22;
  const clipped = focused.map((rows) => rows.filter((y) => Math.abs(y - line) <= limit));
  const focusedImage = assembleCapsule(band, clipped, smooth, at);
  if (!focusedImage) return assembled;
  if (!assembled) return focusedImage;
  if (focusedImage.width > assembled.width * 1.12 && focusedImage.height < assembled.height * 1.85) {
    return focusedImage;
  }
  return assembled;
}

function assembleCapsule(band, columns, smooth, at) {
  const context = band.getContext("2d", { willReadFrequently: true });
  const { width, height } = band;
  const data = context.getImageData(0, 0, width, height).data;
  const runs = [];
  let start = -1;
  let gap = 0;
  const close = (end) => {
    if (start < 0) return;
    runs.push([start, end]);
    start = -1;
  };
  columns.forEach((rows, x) => {
    if (rows.length >= 2) {
      if (start < 0) start = x;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap > 4) close(x - gap);
    }
  });
  close(width - 1);
  let comps = runs.map(([from, to]) => {
    const rows = [];
    let ink = 0;
    for (let x = from; x <= to; x += 1) {
      rows.push(...columns[x]);
      ink += columns[x].length;
    }
    if (!rows.length) return null;
    const top = Math.min(...rows);
    const bottom = Math.max(...rows);
    return {
      from,
      to,
      ink,
      top,
      bottom,
      w: to - from + 1,
      h: bottom - top + 1,
      cy: (top + bottom) / 2
    };
  }).filter((comp) => comp && comp.ink >= 20 && comp.h <= height * 0.72 && comp.h >= height * 0.28);
  if (!comps.length) return null;
  const baseline = median(comps.map((comp) => comp.cy));
  comps = comps.filter((comp) => Math.abs(comp.cy - baseline) <= height * 0.18);
  comps.sort((left, right) => left.from - right.from);
  if (!comps.length) return null;
  const gapLimit = Math.max(14, Math.floor(height * 0.22));
  const clusters = [];
  let current = [comps[0]];
  comps.slice(1).forEach((comp) => {
    if (comp.from - current[current.length - 1].to <= gapLimit) current.push(comp);
    else {
      clusters.push(current);
      current = [comp];
    }
  });
  clusters.push(current);
  const chevronAfter = (cluster) => {
    const widths = median(cluster.map((comp) => comp.w));
    const end = cluster[cluster.length - 1].to;
    return comps.find((comp) => (
      comp.from > end
      && comp.from <= end + Math.floor(height * 0.55)
      && comp.w < widths * 0.7
      && comp.w < comp.h
    )) || null;
  };
  clusters.sort((left, right) => {
    const leftMark = chevronAfter(left) ? 1 : 0;
    const rightMark = chevronAfter(right) ? 1 : 0;
    if (leftMark !== rightMark) return rightMark - leftMark;
    const leftInk = left.reduce((sum, comp) => sum + comp.ink, 0);
    const rightInk = right.reduce((sum, comp) => sum + comp.ink, 0);
    return rightInk - leftInk;
  });
  let names = clusters[0].slice();
  let chevron = chevronAfter(names);
  if (names.length >= 2) {
    const body = median(names.slice(0, -1).map((comp) => comp.w));
    const last = names[names.length - 1];
    if (last.w < body * 0.55 && last.w < last.h * 0.85) {
      chevron = last;
      names = names.slice(0, -1);
    }
  }
  if (!names.length) return null;
  let right = Math.min(width - 1, names[names.length - 1].to + 6);
  if (chevron && chevron.from > names[names.length - 1].to) right = Math.min(right, chevron.from - 2);
  const top = Math.max(0, Math.min(...names.map((comp) => comp.top)) - 5);
  const bottom = Math.min(height - 1, Math.max(...names.map((comp) => comp.bottom)) + 5);
  // The left half of the first character can fall below the white-ink threshold
  // where the capsule darkens. Extend only while faint strokes are still there.
  const lineHeight = Math.max(...names.map((comp) => comp.h));
  const limit = Math.max(0, names[0].from - Math.round(lineHeight * 1.3));
  let faint = names[0].from;
  let empty = 0;
  for (let x = names[0].from - 1; x >= limit; x -= 1) {
    let hits = 0;
    for (let y = top; y <= bottom; y += 1) {
      const pixel = at(x, y);
      const red = data[pixel];
      const green = data[pixel + 1];
      const blue = data[pixel + 2];
      const luminance = luminanceOf(red, green, blue);
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      if (luminance > 145 && chroma < 70 && luminance > smooth[x] + 18) hits += 1;
    }
    if (hits >= 2) {
      faint = x;
      empty = 0;
    } else {
      empty += 1;
      if (empty > 5) break;
    }
  }
  const left = Math.max(0, faint - 4);
  if (right - left < 8 || bottom - top < 8) return null;
  return crop(band, left, top, right - left + 1, bottom - top + 1, 1);
}

function capsuleImage(full) {
  const band = fractionCrop(full, PLACE_BAND);
  const strict = readCapsule(band, false);
  const soft = readCapsule(band, true);
  if (!soft) return strict;
  if (!strict) return soft;
  // The strict mask already has the whole name on a dark pill. A wider soft
  // mask is the rest of a long name whose gray was lifted by the playground.
  if (soft.width > strict.width * 1.35 && soft.height < strict.height * 1.85) return soft;
  return strict;
}

function stretchCapsule(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const levels = [];
  for (let index = 0; index < data.length; index += 4) {
    levels.push(luminanceOf(data[index], data[index + 1], data[index + 2]));
  }
  const low = percentile(levels, 0.42);
  const high = percentile(levels, 0.9);
  if (high - low >= 70) return null;
  const next = document.createElement("canvas");
  next.width = width;
  next.height = height;
  const output = next.getContext("2d").createImageData(width, height);
  const span = Math.max(8, high - low);
  for (let index = 0; index < data.length; index += 4) {
    const luma = luminanceOf(data[index], data[index + 1], data[index + 2]);
    const lifted = Math.min(1, Math.max(0, (luma - low) / span));
    const value = Math.round(255 * (1 - lifted));
    output.data[index] = value;
    output.data[index + 1] = value;
    output.data[index + 2] = value;
    output.data[index + 3] = 255;
  }
  next.getContext("2d").putImageData(output, 0, 0);
  return next;
}

function binarizeCapsule(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const levels = [];
  for (let index = 0; index < data.length; index += 4) {
    levels.push(luminanceOf(data[index], data[index + 1], data[index + 2]));
  }
  const threshold = percentile(levels, 0.4) + 48;
  const next = document.createElement("canvas");
  next.width = width;
  next.height = height;
  const output = next.getContext("2d", { willReadFrequently: true }).createImageData(width, height);
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    const ink = luminanceOf(red, green, blue) > threshold && chroma < 50;
    const value = ink ? 0 : 255;
    output.data[index] = value;
    output.data[index + 1] = value;
    output.data[index + 2] = value;
    output.data[index + 3] = 255;
  }
  next.getContext("2d").putImageData(output, 0, 0);
  return next;
}

function scalePad(canvas, factor, amount) {
  const scaled = scaleCanvas(canvas, factor, true);
  return pad(scaled, amount);
}

async function readLine(worker, canvas, mode, dpi) {
  await worker.setParameters({
    tessedit_pageseg_mode: mode,
    tessedit_char_whitelist: "",
    tessedit_char_blacklist: "",
    user_defined_dpi: String(dpi)
  });
  const { data } = await worker.recognize(canvas);
  return {
    text: data.text || "",
    confidence: Number(data.confidence) || 0
  };
}

async function choosePlace(worker, color) {
  const binary = binarizeCapsule(color);
  const stretched = stretchCapsule(color);
  const reads = [
    await readLine(worker, color, "7", 150),
    await readLine(worker, binary, "7", 150),
    await readLine(worker, scalePad(binary, 2, 24), "7", 180),
    await readLine(worker, scalePad(color, 2, 24), "13", 96)
  ];
  if (stretched) {
    reads.push(await readLine(worker, scalePad(stretched, 2, 24), "7", 180));
  }
  const ranked = reads
    .map((read) => ({ ...read, place: readPlace(read.text) }))
    .filter((read) => read.place)
    .sort((left, right) => right.confidence - left.confidence);
  return ranked[0]?.place || "";
}

function countdownWidth(full) {
  const { width, height } = full;
  const context = full.getContext("2d", { willReadFrequently: true });
  const data = context.getImageData(0, 0, width, height).data;
  const y0 = Math.floor(height * COUNTDOWN_BAND.y);
  const y1 = Math.min(height - 1, Math.floor(height * (COUNTDOWN_BAND.y + COUNTDOWN_BAND.h)));
  const x0 = Math.floor(width * COUNTDOWN_BAND.x);
  const limit = Math.floor(width * (COUNTDOWN_BAND.x + COUNTDOWN_BAND.w));
  const gapLimit = Math.max(40, Math.round(width * 0.045));
  let last = x0;
  let gap = 0;
  let seen = false;
  for (let x = x0; x < limit; x += 1) {
    let ink = 0;
    for (let y = y0; y <= y1; y += 1) {
      const pixel = (y * width + x) * 4;
      const red = data[pixel];
      const green = data[pixel + 1];
      const blue = data[pixel + 2];
      if (Math.min(red, green, blue) >= 200 && Math.max(red, green, blue) - Math.min(red, green, blue) < 40) ink += 1;
    }
    if (ink >= 2) {
      seen = true;
      gap = 0;
      last = x;
    } else if (seen) {
      gap += 1;
      if (gap > gapLimit) break;
    }
  }
  return Math.max(width * 0.2, Math.min(width * COUNTDOWN_BAND.w, last + width * 0.02 - x0));
}

// The white-ink mask is the contrast step: game text becomes solid black and the
// meadow becomes white. One pixel of closing joins a stroke that would otherwise break.
function closeStrokes(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const image = context.getImageData(0, 0, width, height);
  const source = new Uint8ClampedArray(image.data);
  const data = image.data;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let ink = false;
      for (let dy = -1; dy <= 1 && !ink; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (source[((y + dy) * width + (x + dx)) * 4] < 80) {
            ink = true;
            break;
          }
        }
      }
      const index = (y * width + x) * 4;
      const value = ink ? 0 : 255;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(fraction * (sorted.length - 1))];
}

// Daisies in this slot are taller than the countdown glyphs and hang below the line.
// A short "剩下" line has no wide gap before the first flower, so the width rule keeps
// the flower, and a digit whitelist then turns the petals into extra numbers.
function clipCountdown(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const columns = [];
  for (let x = 0; x < width; x += 1) {
    const rows = [];
    for (let y = 0; y < height; y += 1) {
      if (data[(y * width + x) * 4] < 80) rows.push(y);
    }
    columns.push(rows);
  }
  const gapLimit = Math.max(3, Math.round(height * 0.12));
  const runs = [];
  let start = -1;
  let gap = 0;
  const close = (end) => {
    if (start < 0) return;
    runs.push([start, end]);
    start = -1;
  };
  columns.forEach((rows, x) => {
    if (rows.length) {
      if (start < 0) start = x;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap > gapLimit) close(x - gap);
    }
  });
  close(width - 1);
  const comps = runs.map(([from, to]) => {
    const tops = [];
    const bots = [];
    let ink = 0;
    for (let x = from; x <= to; x += 1) {
      const rows = columns[x];
      if (!rows.length) continue;
      tops.push(rows[0]);
      bots.push(rows[rows.length - 1]);
      ink += rows.length;
    }
    return {
      from,
      to,
      ink,
      tops,
      bots,
      w: to - from + 1,
      h: tops.length ? Math.max(...bots) - Math.min(...tops) + 1 : 0
    };
  }).filter((comp) => comp.tops.length);
  if (!comps.length) return canvas;
  const left = comps.filter((comp) => comp.from < width * 0.45 && comp.w >= 8 && comp.h >= height * 0.35);
  const main = (left.length ? left : comps).reduce((best, comp) => (comp.ink > best.ink ? comp : best));
  const base = percentile(main.bots, 0.85);
  const top = percentile(main.tops, 0.15);
  const line = Math.max(8, base - top);
  const slack = Math.max(2, Math.round(line * 0.18));
  const specks = [];
  let flowerAt = width;
  comps.forEach((comp) => {
    const below = comp.bots.filter((value) => value > base + slack).length / comp.bots.length;
    const above = comp.tops.filter((value) => value < top - slack).length / comp.tops.length;
    const speck = comp.h < line * 0.55 && comp.w < main.w * 0.45 && comp.to <= main.from + 2;
    const flower = comp.from > main.to && comp.w >= 6 && comp.h >= line * 0.9 && (below > 0.22 || above > 0.22);
    if (speck) specks.push(comp);
    if (flower) flowerAt = Math.min(flowerAt, comp.from);
  });
  specks.forEach((comp) => {
    for (let x = comp.from; x <= comp.to; x += 1) {
      for (let y = 0; y < height; y += 1) {
        const index = (y * width + x) * 4;
        data[index] = 255;
        data[index + 1] = 255;
        data[index + 2] = 255;
      }
    }
  });
  context.putImageData(image, 0, 0);
  if (flowerAt >= width - 1) return canvas;
  return crop(canvas, 0, 0, Math.max(8, flowerAt), height, 1);
}

function maskedCountdown(native) {
  const strict = recolor(copyCanvas(native), isWhiteInk);
  const masked = inkCount(strict) >= 40 ? strict : recolor(native, isCountdownInk);
  const line = enlargeLine(clipCountdown(closeStrokes(masked)), (image) => image, false);
  return inkCount(line.big) >= 30 ? line : null;
}

// On a bright meadow the strict white mask leaves 剩 thin enough that smoothing
// turns it into a shape the reader rejects, and the hour disappears with it.
// The same line, kept sharp and taken with the wider countdown ink, still reads.
// This pass is used only after the strict line does not parse.
function sharpCountdown(native) {
  const masked = recolor(copyCanvas(native), isCountdownInk);
  if (inkCount(masked) < 40) return null;
  return pad(scaleCanvas(clipCountdown(masked), 3, false), 28);
}

// The smoothed enlargement can drop 剩 at the start and 秒 at the end.
// A sharp copy of the strict white mask still has both, without the meadow ink.
function sharpWhiteCountdown(native) {
  const masked = recolor(copyCanvas(native), isWhiteInk);
  if (inkCount(masked) < 40) return null;
  return pad(scaleCanvas(clipCountdown(masked), 3, false), 28);
}

function countdownBands(full) {
  const band = {
    x: COUNTDOWN_BAND.x,
    y: COUNTDOWN_BAND.y,
    w: countdownWidth(full) / full.width,
    h: COUNTDOWN_BAND.h
  };
  const native = fractionCrop(full, band);
  const line = maskedCountdown(native);
  const soft = sharpCountdown(native);
  const sharp = sharpWhiteCountdown(native);
  if (!line && !soft && !sharp) return [];
  return [{
    half: line?.half || sharp || soft,
    big: line?.big || sharp || soft,
    sharp,
    soft
  }];
}

async function readCountdown(worker, images) {
  const parts = [];
  const take = async (canvas, mode, whitelist, dpi, open) => {
    if (!canvas) return "";
    const text = await readText(worker, canvas, mode, whitelist, dpi);
    parts.push({ text, open });
    return text;
  };
  await take(images.half, "7", "剩下小時分秒0123456789", 300, false);
  await take(images.half, "13", "", 96, true);
  await take(images.half, "7", "", 300, true);
  const listed = await take(images.big, "7", "剩下小時分秒0123456789", 300, false);
  if (images.sharp) {
    await take(images.sharp, "7", "剩下小時分秒0123456789", 300, false);
    await take(images.sharp, "13", "剩下小時分秒0123456789", 300, false);
  }
  if (images.soft) await take(images.soft, "7", "剩下小時分秒0123456789", 300, false);
  const digits = await readText(worker, images.big, "7", "0123456789", 300);
  return chooseRemainingRead(parts, digits, listed);
}

function pickClock(texts) {
  const found = texts
    .map((text) => ({ text: String(text || "").trim(), clock: matchClock(text) }))
    .filter((item) => item.clock);
  const clean = found.find((item) => /^\d{1,2}\s*[:：]\s*\d{2}$/.test(item.text));
  return (clean || found[0])?.clock || null;
}

function statusRuns(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const columns = [];
  for (let x = 0; x < width; x += 1) {
    const rows = [];
    for (let y = 0; y < height; y += 1) {
      if (data[(y * width + x) * 4] < 80) rows.push(y);
    }
    columns.push(rows);
  }
  const runs = [];
  let start = -1;
  let gap = 0;
  const close = (end) => {
    if (start < 0) return;
    const rows = new Set();
    for (let x = start; x <= end; x += 1) columns[x].forEach((y) => rows.add(y));
    if (rows.size) {
      const ordered = [...rows].sort((left, right) => left - right);
      const span = verticalSpan(ordered);
      runs.push({
        start,
        end,
        y0: ordered[0],
        y1: ordered[ordered.length - 1],
        bodyY0: span.y0,
        bodyY1: span.y1,
        parts: span.parts
      });
    }
    start = -1;
  };
  columns.forEach((rows, x) => {
    if (rows.length) {
      if (start < 0) start = x;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap > 2) close(x - gap);
    }
  });
  close(width - 1);
  return runs;
}

// A floating speck above a digit makes the whole run look too tall to be type.
// The digit itself is the tallest solid piece.
function verticalSpan(ordered) {
  let parts = 1;
  let bodyY0 = ordered[0];
  let bodyY1 = ordered[0];
  let bodyLength = 1;
  let segmentY0 = ordered[0];
  let segmentLength = 1;
  const keep = (y1, length) => {
    if (length <= bodyLength) return;
    bodyLength = length;
    bodyY0 = segmentY0;
    bodyY1 = y1;
  };
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index] > ordered[index - 1] + 1) {
      keep(ordered[index - 1], segmentLength);
      parts += 1;
      segmentY0 = ordered[index];
      segmentLength = 1;
    } else {
      segmentLength += 1;
    }
  }
  keep(ordered[ordered.length - 1], segmentLength);
  return { y0: bodyY0, y1: bodyY1, parts };
}

function runBodyHeight(run) {
  const y0 = Number.isFinite(run.bodyY0) ? run.bodyY0 : run.y0;
  const y1 = Number.isFinite(run.bodyY1) ? run.bodyY1 : run.y1;
  return y1 - y0 + 1;
}

function isStatusColon(run, lineHeight) {
  const width = run.end - run.start + 1;
  const height = run.y1 - run.y0 + 1;
  return run.parts === 2 && width <= lineHeight * 0.45 && height >= lineHeight * 0.45 && height <= lineHeight * 0.95;
}

function textSizedRuns(canvas, runs) {
  return runs.filter((run) => {
    const height = runBodyHeight(run);
    return height >= canvas.height * 0.14 && height <= canvas.height * 0.34;
  });
}

// Specks above a digit fuse it with the colon into one tall run, so the dots never
// match. Dropping ink off the text line splits that run back into the digit and the dots.
function clipStatusLine(canvas) {
  const textRuns = textSizedRuns(canvas, statusRuns(canvas));
  if (textRuns.length < 2) return null;
  // A smudge just above the glyphs is not part of the line. Clipping to the
  // solid bodies drops it, which splits a colon that the smudge had fused to a digit.
  const y0 = median(textRuns.map((run) => (Number.isFinite(run.bodyY0) ? run.bodyY0 : run.y0)));
  const y1 = median(textRuns.map((run) => (Number.isFinite(run.bodyY1) ? run.bodyY1 : run.y1)));
  const top = Math.max(0, Math.floor(y0 - 4));
  const bottom = Math.min(canvas.height, Math.ceil(y1 + 6));
  if (bottom - top < 8) return null;
  const next = copyCanvas(canvas);
  const context = next.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, next.width, next.height);
  const data = image.data;
  for (let y = 0; y < next.height; y += 1) {
    if (y >= top && y < bottom) continue;
    for (let x = 0; x < next.width; x += 1) {
      const offset = (y * next.width + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return next;
}

// A bright streak under the minutes can join the last digit to the location arrow
// across one empty column. Cut that bridge so the arrow stays outside the crop.
function splitBridgedRuns(canvas, runs, lineHeight, y0, y1) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const inkAt = (x, top, bottom) => {
    let ink = 0;
    for (let y = top; y <= bottom; y += 1) {
      if (data[(y * width + x) * 4] < 80) ink += 1;
    }
    return ink;
  };
  const piece = (start, end) => {
    const rows = new Set();
    let x0 = -1;
    let x1 = -1;
    for (let x = start; x <= end; x += 1) {
      let any = false;
      for (let y = 0; y < height; y += 1) {
        if (data[(y * width + x) * 4] < 80) {
          rows.add(y);
          any = true;
        }
      }
      if (any) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    }
    if (x0 < 0) return null;
    const ordered = [...rows].sort((left, right) => left - right);
    const span = verticalSpan(ordered);
    return {
      start: x0,
      end: x1,
      y0: ordered[0],
      y1: ordered[ordered.length - 1],
      bodyY0: span.y0,
      bodyY1: span.y1,
      parts: span.parts
    };
  };
  const splitOne = (run) => {
    const runWidth = run.end - run.start + 1;
    if (runWidth <= lineHeight * 1.08) return [run];
    const top = Math.max(0, Math.floor(y0));
    const bottom = Math.min(height - 1, Math.ceil(y1));
    let cut = -1;
    let least = Infinity;
    for (let x = run.start + 1; x < run.end; x += 1) {
      const ink = inkAt(x, top, bottom);
      if (ink < least) {
        least = ink;
        cut = x;
      }
    }
    if (cut < 0 || least > 1) return [run];
    let leftEnd = cut;
    while (leftEnd > run.start && inkAt(leftEnd, top, bottom) <= 1) leftEnd -= 1;
    let rightStart = cut;
    while (rightStart < run.end && inkAt(rightStart, top, bottom) <= 1) rightStart += 1;
    const left = piece(run.start, leftEnd);
    const right = piece(rightStart, run.end);
    if (!left || !right) return [run];
    if (left.end - left.start + 1 >= runWidth || right.end - right.start + 1 >= runWidth) return [run];
    return [...splitOne(left), ...splitOne(right)];
  };
  return runs.flatMap(splitOne);
}

// Glare beside the last minute digit hangs below the bowl and past its right edge.
// Drop those columns so the digit keeps the shape the reader already knows.
function trimLowTail(canvas, run, y0, limitY) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const top = Math.max(0, Math.floor(y0));
  const bottom = Math.min(height - 1, Math.floor(limitY));
  if (bottom <= top) return run;
  const upper = (x) => {
    let ink = 0;
    for (let y = top; y <= bottom; y += 1) {
      if (data[(y * width + x) * 4] < 80) ink += 1;
    }
    return ink;
  };
  let last = run.start - 1;
  for (let x = run.start; x <= run.end; x += 1) {
    if (upper(x)) last = x;
  }
  if (last < run.start || last >= run.end) return run;
  for (let x = last + 1; x <= run.end; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return { ...run, end: last };
}

// Digits sit on either side of the two status-bar dots. Once both minute digits are
// taken, a nearby location arrow is left outside the crop. A thin extra fragment is
// still a split stroke, so that match is dropped and the full mask can be read.
function isolateStatusTime(canvas) {
  return matchStatusTime(canvas) || matchStatusTime(clipStatusLine(canvas));
}

function matchStatusTime(canvas) {
  if (!canvas) return null;
  const runs = statusRuns(canvas);
  const textRuns = textSizedRuns(canvas, runs);
  if (textRuns.length < 3) return null;
  const y0 = median(textRuns.map((run) => (Number.isFinite(run.bodyY0) ? run.bodyY0 : run.y0)));
  const y1 = median(textRuns.map((run) => (Number.isFinite(run.bodyY1) ? run.bodyY1 : run.y1)));
  const lineHeight = y1 - y0 + 1;
  if (lineHeight < 8) return null;
  const aligned = splitBridgedRuns(canvas, runs.filter((run) => {
    const top = Number.isFinite(run.bodyY0) ? run.bodyY0 : run.y0;
    const bottom = Number.isFinite(run.bodyY1) ? run.bodyY1 : run.y1;
    const height = bottom - top + 1;
    return top >= y0 - 4 && bottom <= y1 + 6 && height <= lineHeight * 1.35;
  }), lineHeight, y0, y1);
  const sideOf = (colonIndex, direction) => {
    const taken = [];
    let previous = aligned[colonIndex];
    for (let index = colonIndex + direction; index >= 0 && index < aligned.length; index += direction) {
      const run = aligned[index];
      const gap = direction > 0 ? run.start - previous.end - 1 : previous.start - run.end - 1;
      if (gap > lineHeight * 0.6) break;
      const width = run.end - run.start + 1;
      const height = runBodyHeight(run);
      if (isStatusColon(run, lineHeight) || width > lineHeight * 1.08 || height > lineHeight * 1.25) break;
      if (taken.length >= 2) {
        if (direction > 0) {
          const body = median(taken.map((item) => item.end - item.start + 1));
          if (width >= body * 0.85) break;
        }
        return null;
      }
      taken.push(run);
      previous = run;
    }
    return direction > 0 ? taken : taken.reverse();
  };
  const matches = [];
  aligned.forEach((run, index) => {
    if (!isStatusColon(run, lineHeight)) return;
    const left = sideOf(index, -1);
    const right = sideOf(index, 1);
    if (!left || !right || left.length < 1 || left.length > 2 || right.length !== 2) return;
    matches.push({ left, right });
  });
  if (matches.length !== 1) return null;
  const { left, right } = matches[0];
  const bodies = [...left, ...right].filter((run) => run.y1 - run.y0 + 1 <= lineHeight * 0.8);
  const bodyBottom = bodies.length ? Math.max(...bodies.map((run) => run.y1)) : y1;
  const cleanHeight = bodies.length
    ? Math.max(...bodies.map((run) => run.y1 - run.y0 + 1))
    : lineHeight;
  const trimmed = trimLowTail(canvas, right[right.length - 1], y0, y0 + cleanHeight * 0.58);
  right[right.length - 1] = trimmed;
  const from = left[0].start;
  const to = trimmed.end;
  const next = aligned.find((run) => run.start > to + 1);
  const cropLeft = Math.max(0, from - 6);
  const cropTop = Math.max(0, y0 - 4);
  const cropRight = Math.min(canvas.width, next ? Math.min(to + 7, next.start - 1) : to + 7);
  const cropBottom = Math.min(canvas.height, Math.min(y1, bodyBottom) + 5);
  return {
    canvas: crop(canvas, cropLeft, cropTop, cropRight - cropLeft, cropBottom - cropTop, 1),
    leftCount: left.length
  };
}

function digitsClock(text, leftCount) {
  const digits = String(text || "").replace(/\D/g, "");
  if (!leftCount || digits.length !== leftCount + 2) return null;
  const hour = Number(digits.slice(0, leftCount));
  const minute = Number(digits.slice(leftCount));
  if (hour > 23 || minute > 59) return null;
  return { hour, minute, meridiem: null };
}

async function readIsolatedClock(worker, masked) {
  const isolated = isolateStatusTime(masked);
  if (!isolated) return null;
  const text = await readText(worker, pad(scaleCanvas(isolated.canvas, 3, false)), "7", "0123456789:");
  return pickClock([text]) || digitsClock(text, isolated.leftCount);
}

async function readStatusClock(worker, full, keep) {
  // Threshold the status crop before enlarging it. Smoothing the color photo
  // first washes white type into the background and melts black type into a hedge.
  const masked = recolor(fractionCrop(full, CLOCK_BAND), keep);
  const area = masked.width * masked.height;
  const count = inkCount(masked);
  // A filled night scene is not a clock. Reading that mask invents a time.
  if (count < area * 0.008 || count > area * 0.12) return null;
  const isolated = await readIsolatedClock(worker, masked);
  if (isolated) return isolated;
  const text = await readText(worker, pad(scaleCanvas(masked, 3, false)), "7", "0123456789:");
  return pickClock([text]);
}

function maskFraction(full, band, keep) {
  const x0 = Math.max(0, Math.floor(full.width * band.x));
  const y0 = Math.max(0, Math.floor(full.height * band.y));
  const x1 = Math.min(full.width, Math.ceil(full.width * (band.x + band.w)));
  const y1 = Math.min(full.height, Math.ceil(full.height * (band.y + band.h)));
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const source = full.getContext("2d", { willReadFrequently: true }).getImageData(x0, y0, width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const image = canvas.getContext("2d", { willReadFrequently: true }).createImageData(width, height);
  for (let index = 0; index < source.data.length; index += 4) {
    const ink = keep(source.data[index], source.data[index + 1], source.data[index + 2]);
    const value = ink ? 0 : 255;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  canvas.getContext("2d").putImageData(image, 0, 0);
  return canvas;
}

// A black clock on a dark wall fills the usual mask, so that read is refused.
// Sample the original pixels and keep only the solid black core. A time is
// accepted only when the digits and the colon separate from the wall.
async function readDenseDarkClock(worker, full) {
  for (const limit of [32, 24, 16, 12]) {
    const masked = maskFraction(full, CLOCK_BAND, darkInkAt(limit));
    const area = masked.width * masked.height;
    const count = inkCount(masked);
    if (count < area * 0.008 || count > area * 0.12) continue;
    const clock = await readIsolatedClock(worker, masked);
    if (clock) return clock;
  }
  return null;
}

export async function recognizeScreenshot(source) {
  const worker = await getWorker();
  const full = await loadCanvas(source);

  // The phone clock is the leftmost status time. Its box stays left of the center pill,
  // which can show a second time. The box is a fraction of this screenshot.
  const clock = await readStatusClock(worker, full, isLightInk)
    || await readStatusClock(worker, full, isDarkInk)
    || await readDenseDarkClock(worker, full);
  const place = capsuleImage(full);
  const location = place ? await choosePlace(worker, place) : "";

  let remaining = null;
  for (const remain of countdownBands(full)) {
    remaining = await readCountdown(worker, remain);
    if (remaining) break;
  }

  return {
    location,
    remaining,
    clock
  };
}
