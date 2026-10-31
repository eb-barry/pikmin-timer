import Tesseract from "../vendor/tesseract/tesseract.esm.min.js";
import { matchClock, parseRemaining, parseSplitDigits, readPlace } from "./parse.js";

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

async function readText(worker, canvas, mode, whitelist = "") {
  await worker.setParameters({
    tessedit_pageseg_mode: mode,
    tessedit_char_whitelist: whitelist
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

function scaleCanvas(canvas, factor) {
  if (factor <= 1) return canvas;
  const next = document.createElement("canvas");
  next.width = Math.max(1, Math.round(canvas.width * factor));
  next.height = Math.max(1, Math.round(canvas.height * factor));
  const context = next.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
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

function countdownBands(full) {
  const sheet = findSheetTop(full);
  const width = full.width;
  const height = full.height;
  const anchor = sheet == null ? height * 0.488 : sheet;
  const make = (delta, band, portion, scale) => {
    const native = crop(full, 0, Math.max(0, anchor - height * delta), width * portion, Math.max(18, height * band), 1);
    const strict = recolor(copyCanvas(native), isWhiteInk);
    const masked = inkCount(strict) >= 80 ? strict : recolor(native, isCountdownInk);
    return pad(tightInk(trimAfterText(scaleCanvas(masked, scale))), 36);
  };
  return [
    make(0.03, 0.018, 0.5, 3),
    make(0.046, 0.038, 0.68, 3)
  ];
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
  const lightPill = pad(recolor(
    crop(full, width * 0.15, height * 0.082, width * 0.7, height * 0.058, 3),
    isLightInk
  ));
  const colorPill = crop(full, width * 0.15, height * 0.082, width * 0.7, height * 0.058, 2);

  const lightTime = await readText(worker, lightStatus, "7", "0123456789:");
  const darkTime = await readText(worker, darkStatus, "7", "0123456789:");
  const pillText = await readText(worker, lightPill, "7", "");
  let location = readPlace(pillText);
  if (!location) location = readPlace(await readText(worker, colorPill, "7", ""));

  let remaining = null;
  for (const remain of countdownBands(full)) {
    const line = await readText(worker, remain, "13", "");
    remaining = parseRemaining(line);
    if (remaining) break;
    const listed = await readText(worker, remain, "7", "剩下小時分秒0123456789");
    const digits = await readText(worker, remain, "7", "0123456789");
    remaining = parseRemaining(listed) || parseSplitDigits(listed, digits);
    if (remaining) break;
  }

  return {
    location,
    remaining,
    clock: pickClock([lightTime, darkTime])
  };
}
