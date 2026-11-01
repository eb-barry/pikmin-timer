import Tesseract from "../vendor/tesseract/tesseract.esm.min.js";
import { matchClock, parseDigitRun, parseRemaining, parseSplitDigits, readPlace } from "./parse.js";

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

function isDarkInk(red, green, blue) {
  return red < 80 && green < 80 && blue < 80;
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
function capsuleImage(full) {
  const band = fractionCrop(full, PLACE_BAND);
  const context = band.getContext("2d", { willReadFrequently: true });
  const { width, height } = band;
  const data = context.getImageData(0, 0, width, height).data;
  const at = (x, y) => (y * width + x) * 4;
  const background = [];
  for (let x = 0; x < width; x += 1) {
    const column = [];
    for (let y = 0; y < height; y += 1) {
      const pixel = at(x, y);
      column.push(luminanceOf(data[pixel], data[pixel + 1], data[pixel + 2]));
    }
    background.push(percentile(column, 0.35));
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
      if (luminance > smooth[x] + 50 && chroma < 42 && luminance > 165) rows.push(y);
    }
    columns.push(rows);
  }
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
  let left = Math.max(0, names[0].from - 6);
  let right = Math.min(width - 1, names[names.length - 1].to + 6);
  if (chevron && chevron.from > names[names.length - 1].to) right = Math.min(right, chevron.from - 2);
  const top = Math.max(0, Math.min(...names.map((comp) => comp.top)) - 5);
  const bottom = Math.min(height - 1, Math.max(...names.map((comp) => comp.bottom)) + 5);
  if (right - left < 8 || bottom - top < 8) return null;
  return crop(band, left, top, right - left + 1, bottom - top + 1, 1);
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
  const reads = [
    await readLine(worker, color, "7", 150),
    await readLine(worker, binary, "7", 150),
    await readLine(worker, scalePad(binary, 2, 24), "7", 180),
    await readLine(worker, scalePad(color, 2, 24), "13", 96)
  ];
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

function countdownBands(full) {
  const band = {
    x: COUNTDOWN_BAND.x,
    y: COUNTDOWN_BAND.y,
    w: countdownWidth(full) / full.width,
    h: COUNTDOWN_BAND.h
  };
  const line = maskedCountdown(fractionCrop(full, band));
  return line ? [line] : [];
}

function acceptRemaining(text) {
  if (/[A-Za-z]{2,}/.test(String(text || ""))) return null;
  return parseRemaining(text);
}

async function readCountdown(worker, images) {
  const listedHalf = await readText(worker, images.half, "7", "剩下小時分秒0123456789", 300);
  const fromListedHalf = parseRemaining(listedHalf);
  if (fromListedHalf) return fromListedHalf;
  const halfOpen = await readText(worker, images.half, "13", "", 96);
  const fromHalf = acceptRemaining(halfOpen);
  if (fromHalf) return fromHalf;
  const halfLine = await readText(worker, images.half, "7", "", 300);
  const fromLine = acceptRemaining(halfLine);
  if (fromLine) return fromLine;
  const listed = await readText(worker, images.big, "7", "剩下小時分秒0123456789", 300);
  const fromListed = parseRemaining(listed);
  if (fromListed) return fromListed;
  const digits = await readText(worker, images.big, "7", "0123456789", 300);
  const compact = String(digits || "").replace(/\D/g, "");
  if (compact.length !== 4) return parseSplitDigits(listed, digits);
  return parseSplitDigits(listed, digits) || parseDigitRun(digits, `${listed} ${halfOpen} ${halfLine}`);
}

function pickClock(texts) {
  const found = texts
    .map((text) => ({ text: String(text || "").trim(), clock: matchClock(text) }))
    .filter((item) => item.clock);
  const clean = found.find((item) => /^\d{1,2}\s*[:：]\s*\d{2}$/.test(item.text));
  return (clean || found[0])?.clock || null;
}

export async function recognizeScreenshot(source) {
  const worker = await getWorker();
  const full = await loadCanvas(source);

  // The phone clock is the leftmost status time. Its box stays left of the center pill,
  // which can show a second time. The box is a fraction of this screenshot.
  const status = scaleCanvas(fractionCrop(full, CLOCK_BAND), 3, true);
  const lightTime = await readText(worker, pad(recolor(copyCanvas(status), isLightInk)), "7", "0123456789:");
  const darkTime = await readText(worker, pad(recolor(status, isDarkInk)), "7", "0123456789:");
  const clock = pickClock([lightTime, darkTime]);
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
