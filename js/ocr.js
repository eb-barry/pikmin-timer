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

function findSheetTop(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const samples = 36;
  let run = 0;
  for (let y = Math.floor(height * 0.28); y < Math.floor(height * 0.78); y += 1) {
    let white = 0;
    for (let index = 0; index < samples; index += 1) {
      const x = Math.floor(((index + 0.5) / samples) * width);
      const pixel = (y * width + x) * 4;
      if (data[pixel] > 236 && data[pixel + 1] > 236 && data[pixel + 2] > 236) white += 1;
    }
    if (white >= samples * 0.7) {
      run += 1;
      if (run >= 4) return y - 3;
    } else {
      run = 0;
    }
  }
  return null;
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

function isPlaceInk(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return min >= 224 && max - min < 24;
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

function trimAfterText(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const columns = [];
  for (let x = 0; x < width; x += 1) {
    let ink = 0;
    for (let y = 0; y < height; y += 2) {
      if (data[(y * width + x) * 4] < 48) ink += 1;
    }
    columns.push(ink);
  }
  let seen = false;
  let gap = 0;
  let cut = width;
  for (let x = 0; x < width; x += 1) {
    if (columns[x] > 1) {
      seen = true;
      gap = 0;
    } else if (seen) {
      gap += 1;
      if (gap > 72 && x > width * 0.46) {
        cut = x - gap;
        break;
      }
    }
  }
  if (cut >= width - 8) return canvas;
  return crop(canvas, 0, 0, Math.min(width, cut + 12), height, 1);
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

function placeImage(full) {
  const native = recolor(
    crop(full, full.width * 0.08, full.height * 0.078, full.width * 0.84, full.height * 0.072, 1),
    isPlaceInk
  );
  return enlargeLine(native, trimAfterText);
}

function countdownSpan(full) {
  const sheet = findSheetTop(full);
  const { width, height } = full;
  const anchor = sheet == null ? height * 0.5 : sheet;
  const top = Math.max(0, Math.floor(anchor - height * 0.062));
  const bottom = Math.min(height - 1, Math.floor(anchor - height * 0.016));
  const context = full.getContext("2d", { willReadFrequently: true });
  const data = context.getImageData(0, 0, width, height).data;
  const x0 = Math.floor(width * 0.012);
  const xEnd = Math.floor(width * 0.58);
  const rows = [];
  for (let y = top; y <= bottom; y += 1) {
    let ink = 0;
    let first = xEnd;
    let last = 0;
    for (let x = x0; x < xEnd; x += 1) {
      const pixel = (y * width + x) * 4;
      if (isWhiteInk(data[pixel], data[pixel + 1], data[pixel + 2])) {
        ink += 1;
        if (x < first) first = x;
        if (x > last) last = x;
      }
    }
    rows.push({ ink, span: last > first ? last - first : 0 });
  }
  const clusters = [];
  let start = -1;
  let sum = 0;
  let span = 0;
  const close = (end) => {
    if (start < 0) return;
    const band = end - start + 1;
    if (band >= 8 && band <= height * 0.028 && sum >= 80 && span >= 70) {
      clusters.push({ start: top + start, end: top + end, sum, span });
    }
    start = -1;
    sum = 0;
    span = 0;
  };
  rows.forEach((row, index) => {
    if (row.ink >= 8) {
      if (start < 0) start = index;
      sum += row.ink;
      span = Math.max(span, row.span);
    } else {
      close(index - 1);
    }
  });
  close(rows.length - 1);
  if (!clusters.length) return null;
  const chosen = clusters.reduce((best, cluster) => (cluster.end > best.end ? cluster : best));
  const margin = 4;
  const y = Math.max(0, chosen.start - margin);
  return {
    x: width * 0.008,
    y,
    w: width * 0.7,
    h: Math.min(height - y, chosen.end - chosen.start + 1 + margin * 2)
  };
}

function maskedCountdown(native) {
  const strict = recolor(copyCanvas(native), isWhiteInk);
  const masked = inkCount(strict) >= 40 ? strict : recolor(native, isCountdownInk);
  const line = enlargeLine(masked, (image) => image, false);
  return inkCount(line.big) >= 30 ? line : null;
}

function countdownBands(full) {
  const images = [];
  const span = countdownSpan(full);
  if (span) {
    const line = maskedCountdown(crop(full, span.x, span.y, span.w, span.h, 1));
    if (line) images.push(line);
  }
  if (images.length) return images;
  const sheet = findSheetTop(full);
  const anchor = sheet == null ? full.height * 0.488 : sheet;
  const fallback = maskedCountdown(crop(
    full,
    0,
    Math.max(0, anchor - full.height * 0.03),
    full.width * 0.62,
    Math.max(18, full.height * 0.022),
    1
  ));
  return fallback ? [fallback] : [];
}

function acceptRemaining(text) {
  if (/[A-Za-z]{2,}/.test(String(text || ""))) return null;
  return parseRemaining(text);
}

async function readCountdown(worker, images) {
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
  const width = full.width;
  const height = full.height;

  const lightStatus = pad(recolor(
    crop(full, 0, 0, width * 0.5, height * 0.07, 3),
    isLightInk
  ));
  const darkStatus = pad(recolor(
    crop(full, 0, 0, width * 0.5, height * 0.07, 3),
    isDarkInk
  ));
  const lightTime = await readText(worker, lightStatus, "7", "0123456789:");
  const darkTime = await readText(worker, darkStatus, "7", "0123456789:");
  const place = placeImage(full);
  const placeText = await readText(worker, place.half, "13", "", 96);
  let location = readPlace(placeText);
  if (!location) location = readPlace(await readText(worker, place.big, "13", "", 96));

  let remaining = null;
  for (const remain of countdownBands(full)) {
    remaining = await readCountdown(worker, remain);
    if (remaining) break;
  }

  return {
    location,
    remaining,
    clock: pickClock([lightTime, darkTime])
  };
}
