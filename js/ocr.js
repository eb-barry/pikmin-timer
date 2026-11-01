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

// Every slot is a fraction of the screenshot being read, so a taller or shorter phone
// uses the same layout. Measured on every game screen we have, the fractions match:
// place name 9.5%–11.2% of the height, hit points 42.2%–45.6%, countdown 45.9%–47.0%.
// The line height stays fixed. The width grows with the number of characters, so the
// countdown box stops at the first wide gap after the white text.
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

function placeImage(full) {
  const native = recolor(fractionCrop(full, PLACE_BAND), isPlaceInk);
  return enlargeLine(native, trimAfterText);
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

function maskedCountdown(native) {
  const strict = recolor(copyCanvas(native), isWhiteInk);
  const masked = inkCount(strict) >= 40 ? strict : recolor(native, isCountdownInk);
  const line = enlargeLine(closeStrokes(masked), (image) => image, false);
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
  const place = placeImage(full);
  const placeText = await readText(worker, place.half, "13", "", 96);
  let location = readPlace(placeText);
  if (!location) location = readPlace(await readText(worker, place.big, "13", "", 96));
  if (!location) {
    // A short place name can be snapped to an English word. Read it again as Chinese only.
    await worker.setParameters({
      tessedit_char_blacklist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    });
    try {
      location = readPlace(await readText(worker, place.half, "13", "", 96));
    } finally {
      await worker.setParameters({ tessedit_char_blacklist: "" });
    }
  }

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
