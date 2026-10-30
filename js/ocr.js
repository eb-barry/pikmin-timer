import Tesseract from "../vendor/tesseract/tesseract.esm.min.js";
import { matchClock, parseRemaining, readPlace } from "./parse.js";

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
  const maxEdge = 1400;
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

function isCountdownInk(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return red > 205 && green > 188 && blue > 170 && max - min < 55;
}

function countdownBand(full) {
  const sheet = findSheetTop(full);
  const width = full.width;
  const height = full.height;
  const bandHeight = Math.max(32, Math.round(height * 0.034));
  const top = sheet == null
    ? Math.round(height * 0.44)
    : Math.max(0, sheet - Math.round(height * 0.01) - bandHeight);
  return recolor(crop(full, 0, top, width * 0.76, bandHeight, 3), isCountdownInk);
}

export async function recognizeScreenshot(source) {
  const worker = await getWorker();
  const full = await loadCanvas(source);
  const width = full.width;
  const height = full.height;

  const status = recolor(
    crop(full, 0, 0, width * 0.52, height * 0.08, 3),
    (red, green, blue) => red < 80 && green < 80 && blue < 80
  );
  const pill = crop(full, width * 0.08, height * 0.055, width * 0.84, height * 0.105, 2);

  const statusText = await readText(worker, status, "7", "0123456789:");
  const pillText = await readText(worker, pill, "7", "");
  const remain = countdownBand(full);
  let remainText = await readText(worker, remain, "7", "");
  let remaining = parseRemaining(remainText);
  if (!remaining) {
    remainText = `${remainText}\n${await readText(worker, remain, "6", "剩下小時分秒0123456789")}`;
    remaining = parseRemaining(remainText);
  }

  return {
    location: readPlace(pillText),
    remaining,
    clock: matchClock(statusText)
  };
}
