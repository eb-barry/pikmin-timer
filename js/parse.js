const REJECT = /蘑菇|皮克敏|參加|工作力|特殊活動|前往這裡|前往|萬聖節|巨大|剩下|消滅|小時|分鐘|合計/;

function squash(value) {
  return String(value || "")
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "");
}

function clampRemain(hours, minutes, seconds) {
  return {
    hours: Math.min(99, Math.max(0, hours)),
    minutes: Math.min(59, Math.max(0, minutes)),
    seconds: Math.min(59, Math.max(0, seconds))
  };
}

export function parseSplitDigits(listed, digits) {
  if (parseRemaining(listed)) return null;
  const han = squash(listed);
  if (/小時/.test(han) || !/分/.test(han)) return null;
  const head = han.match(/(\d+)/);
  const compact = String(digits || "").replace(/\D/g, "");
  if (!head || !compact.startsWith(head[1])) return null;
  const rest = compact.slice(head[1].length);
  if (!/^\d{1,2}$/.test(rest)) return null;
  return clampRemain(0, Number(head[1]), Number(rest));
}

export function parseDigitRun(digits, witness = "") {
  const note = squash(witness);
  if (!/分|秒|剩/.test(note) || parseRemaining(note)) return null;
  const compact = String(digits || "").replace(/\D/g, "");
  const take = (hours, minutes, seconds) => (
    minutes <= 59 && seconds <= 59 ? clampRemain(hours, minutes, seconds) : null
  );
  if (compact.length === 3) {
    if (!/分/.test(note)) return null;
    return take(0, Number(compact.slice(0, 2)), Number(compact.slice(2)));
  }
  if (compact.length === 4) return take(0, Number(compact.slice(0, 2)), Number(compact.slice(2)));
  if (compact.length === 5) return take(Number(compact.slice(0, 1)), Number(compact.slice(1, 3)), Number(compact.slice(3)));
  if (compact.length === 6) return take(Number(compact.slice(0, 2)), Number(compact.slice(2, 4)), Number(compact.slice(4)));
  return null;
}

export function parseRemaining(text) {
  const source = squash(text);
  const withHours = source.match(/(\d+)\D{0,4}小時\D{0,4}(\d+)\D{0,4}分\D{0,4}(\d+)\D{0,4}秒/);
  if (withHours && /剩下|小時/.test(source)) {
    return clampRemain(Number(withHours[1]), Number(withHours[2]), Number(withHours[3]));
  }
  if (/小時/.test(source)) return null;
  const minutes = source.match(/剩下(\d+)分(\d+)秒/) || source.match(/(\d+)分(\d+)秒/);
  if (minutes && /剩下|分/.test(source)) {
    return clampRemain(0, Number(minutes[1]), Number(minutes[2]));
  }
  const seconds = source.match(/^剩下(\d{1,2})秒$/);
  if (seconds) return clampRemain(0, 0, Number(seconds[1]));
  const english = String(text || "").match(/(\d+)\s*h(?:ours?)?\s*(\d+)\s*m(?:in(?:utes?)?)?\s*(\d+)\s*s(?:ec(?:onds?)?)?/i);
  if (english) return clampRemain(Number(english[1]), Number(english[2]), Number(english[3]));
  return null;
}

export function matchClock(text) {
  const source = String(text || "").trim().replace(/[oO]/g, "0");
  if (!source) return null;
  const matched = source.match(/(上午|下午|am|pm)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/i);
  if (!matched) return null;
  const hour = Number(matched[2]);
  const minute = Number(matched[3]);
  if (hour > 23 || minute > 59) return null;
  const tag = (matched[1] || "").toLowerCase();
  let meridiem = null;
  if (tag === "下午" || tag === "pm") meridiem = "pm";
  if (tag === "上午" || tag === "am") meridiem = "am";
  return { hour, minute, meridiem };
}

function boxOf(line) {
  const box = line?.bbox || line?.box || {};
  return {
    x0: box.x0 ?? 0,
    y0: box.y0 ?? 0,
    x1: box.x1 ?? 0,
    y1: box.y1 ?? 0
  };
}

function cjkCount(text) {
  return (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
}

export function cleanLocation(text) {
  const compact = String(text || "")
    .replace(/[>›»＞〉》〈《」』｜|]/g, "")
    .replace(/\s+/g, "");
  const runs = compact.match(/[\u4e00-\u9fff]{2,}/g) || [];
  runs.sort((a, b) => b.length - a.length);
  return (runs[0] || "").slice(0, 18);
}

export function readPlace(text) {
  const cleaned = cleanLocation(text);
  if (cleaned.length < 2 || cleaned.length > 18) return "";
  if (cjkCount(cleaned) < 2) return "";
  if (REJECT.test(cleaned)) return "";
  if (matchClock(cleaned)) return "";
  return cleaned;
}

export function parseScreenshotText({ text = "", lines = [], width = 1, height = 1 } = {}) {
  const joined = [text, ...lines.map((line) => line.text || "")].join("\n");
  const remaining = parseRemaining(joined);

  const located = lines.map((line) => ({ text: line.text || "", box: boxOf(line) }));
  const topClock = located
    .filter((line) => line.box.y0 <= height * 0.22)
    .sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0)
    .map((line) => matchClock(line.text))
    .find(Boolean);
  const clock = topClock || matchClock(String(text).split(/\n/).slice(0, 4).join(" "));

  let location = "";
  const placeLines = located
    .filter((line) => line.box.y0 <= height * 0.42)
    .map((line) => ({ text: readPlace(line.text), y: line.box.y0 }))
    .filter((line) => line.text);
  if (placeLines.length) {
    placeLines.sort((a, b) => Math.abs(a.y - height * 0.12) - Math.abs(b.y - height * 0.12));
    location = placeLines[0].text;
  } else {
    location = String(text)
      .split(/\n/)
      .map((line) => readPlace(line))
      .find(Boolean) || "";
  }

  return { location, remaining, clock };
}
