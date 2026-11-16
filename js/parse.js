const REJECT = /蘑菇|皮克敏|參加|工作力|特殊活動|前往這裡|前往|萬聖節|巨大|剩下|消滅|小時|分鐘|合計/;

function squash(value) {
  return String(value || "")
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "");
}

function remainSource(text) {
  return squash(text)
    .replace(/小时/g, "小時")
    .replace(/(\d)时/g, "$1時")
    .replace(/(\d)份/g, "$1分")
    .replace(/(\d)[杪抄妙]/g, "$1秒");
}

function clampRemain(hours, minutes, seconds) {
  return {
    hours: Math.min(99, Math.max(0, hours)),
    minutes: Math.min(59, Math.max(0, minutes)),
    seconds: Math.min(59, Math.max(0, seconds))
  };
}

// "4分42秒" loses 秒 in one pass and the digit pass reads that 秒 as one more
// number, so the digits are 4424. Splitting those four digits as minutes and
// seconds stores 44:24. The 分 that is still in the text is the split to keep.
// A leftover that repeats the last second digit is not that stray 秒: "1分05"
// against digits 1055 is a 10分55 line that lost a doubled digit, and the four
// digits stay the minutes and seconds.
function fenAnchored(text, digits) {
  const han = remainSource(text);
  if (/小時/.test(han) || !/分/.test(han)) return null;
  const compact = String(digits || "").replace(/\D/g, "");
  const marked = han.match(/(\d{1,2})分(\d{2})(?!\d)/);
  if (marked) {
    const minutes = Number(marked[1]);
    const seconds = Number(marked[2]);
    if (minutes > 59 || seconds > 59) return null;
    const body = marked[1] + marked[2];
    if (!compact.startsWith(body)) return null;
    const extra = compact.slice(body.length);
    if (extra.length > 1) return null;
    if (extra.length === 1 && extra === marked[2].slice(-1)) return null;
    return clampRemain(0, minutes, seconds);
  }
  const headOnly = han.match(/(?:^|[^\d])(\d)分(?!\d)/);
  if (!headOnly || !compact.startsWith(headOnly[1])) return null;
  const rest = compact.slice(1);
  if (!/^\d{3}$/.test(rest)) return null;
  const seconds = Number(rest.slice(0, 2));
  if (seconds > 59 || rest[2] === rest[1]) return null;
  return clampRemain(0, Number(headOnly[1]), seconds);
}

export function parseSplitDigits(listed, digits) {
  if (parseRemaining(listed)) return null;
  const anchored = fenAnchored(listed, digits);
  if (anchored) return anchored;
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
  const source = remainSource(text);
  // The countdown is the time after 剩下. Digits in front of it are the hit points.
  const marked = source.lastIndexOf("剩下");
  const at = marked >= 0 ? marked : source.lastIndexOf("剩");
  const body = at >= 0 ? source.slice(at) : source;
  const withHours = body.match(/(\d+)\D{0,4}小時\D{0,4}(\d+)\D{0,4}分\D{0,4}(\d+)\D{0,4}秒/);
  if (withHours && /剩下|小時/.test(body)) {
    return clampRemain(Number(withHours[1]), Number(withHours[2]), Number(withHours[3]));
  }
  // 剩 and 秒 sit at the two ends of the line and are the first strokes a reader drops.
  // Accept the hour line only when the trailing number is not a longer run of digits.
  const hoursOpen = body.match(/(\d{1,2})\D{0,3}小時\D{0,3}(\d{1,2})\D{0,3}分\D{0,3}(\d{1,2})(?!\d)/);
  if (hoursOpen && /小時/.test(body) && /分/.test(body)) {
    return clampRemain(Number(hoursOpen[1]), Number(hoursOpen[2]), Number(hoursOpen[3]));
  }
  if (/小時/.test(body)) return null;
  const minutes = body.match(/剩下(\d{1,2})分鐘?(\d{1,2})秒/) || body.match(/(\d{1,2})分鐘?(\d{1,2})秒/);
  if (minutes && /剩下|分/.test(body)) {
    return clampRemain(0, Number(minutes[1]), Number(minutes[2]));
  }
  // The last stroke of 秒 is often missing. A line that still has 剩下 can keep a
  // one-digit second. A line that has already lost 剩 cannot: "下5分6" is what
  // 59分56 becomes after both anchors and one digit from each number fall off,
  // and that fragment must not be stored as the countdown.
  const droppedSecond = body.match(/剩下(\d{1,2})分鐘?(\d{1,2})(?!\d)/) || body.match(/^下(\d{1,2})分鐘?(\d{2})(?!\d)/);
  if (droppedSecond) return clampRemain(0, Number(droppedSecond[1]), Number(droppedSecond[2]));
  const seconds = body.match(/^剩下(\d{1,2})秒$/);
  if (seconds) return clampRemain(0, 0, Number(seconds[1]));
  const english = String(text || "").match(/(\d+)\s*h(?:ours?)?\s*(\d+)\s*m(?:in(?:utes?)?)?\s*(\d+)\s*s(?:ec(?:onds?)?)?/i);
  if (english) return clampRemain(Number(english[1]), Number(english[2]), Number(english[3]));
  return null;
}

export function acceptRemaining(text) {
  if (/[A-Za-z]{2,}/.test(String(text || ""))) return null;
  return parseRemaining(text);
}

function remainKey(value) {
  return `${value.hours}:${value.minutes}:${value.seconds}`;
}

function strictRemain(text) {
  const body = remainSource(text);
  return /剩下/.test(body) && /秒/.test(body) && (/分/.test(body) || /小時/.test(body));
}

function agreedRemain(items) {
  if (!items.length) return null;
  const counts = new Map();
  items.forEach((item) => {
    const key = remainKey(item.value);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  let bestKey = "";
  let bestCount = 0;
  let tied = false;
  counts.forEach((count, key) => {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  });
  if (!bestKey || tied) return null;
  return items.find((item) => remainKey(item.value) === bestKey).value;
}

function salvageLeadingNoise(text) {
  return String(text || "").replace(/^[A-Za-z]{1,4}\s*(?=\d)/, "");
}

// Several reads of the same line have to name one destruction time. A complete
// reading wins when those copies agree. A dropped first digit, such as 18 read
// once as 8, is settled by the other copies instead of discarding the line.
export function chooseRemainingRead(parts, digits = "", listed = "") {
  const parsed = [];
  const witness = [];
  for (const part of parts) {
    const text = String(part?.text || "");
    witness.push(text);
    let source = text;
    let value = part?.open ? acceptRemaining(text) : parseRemaining(text);
    if (!value && part?.open) {
      const cleaned = salvageLeadingNoise(text);
      if (cleaned !== text) {
        value = parseRemaining(cleaned);
        source = cleaned;
      }
    }
    if (value) parsed.push({ text: source, value, strict: strictRemain(source) });
  }
  const strict = parsed.filter((item) => item.strict);
  const fromStrict = agreedRemain(strict);
  if (fromStrict) return fromStrict;
  if (strict.length > 1) {
    const fromAll = agreedRemain(parsed);
    if (fromAll) return fromAll;
    return null;
  }
  if (parsed.length) return agreedRemain(parsed);
  const anchored = [];
  const seen = new Set();
  for (const text of [listed, ...(parts || []).map((part) => part?.text)]) {
    const value = fenAnchored(text, digits);
    if (!value) continue;
    const key = remainKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    anchored.push(value);
  }
  if (anchored.length === 1) return anchored[0];
  if (anchored.length > 1) return null;
  const split = parseSplitDigits(listed, digits);
  const compact = String(digits || "").replace(/\D/g, "");
  if (compact.length !== 4) return split;
  return split || parseDigitRun(digits, witness.join(" "));
}

// A meadow fallback can read an hour line after the pure-white mask has already
// failed. A minute digit painted on a daisy flips when the crop moves a few
// pixels, so that fallback may keep a minute line only when 剩下 is still present.
export function chooseMeadowRead(text) {
  const body = remainSource(text);
  const value = parseRemaining(text);
  if (!value) return null;
  if (/小時/.test(body) && /分/.test(body)) return value;
  if (/剩下/.test(body) && /秒/.test(body)) return value;
  return null;
}

function minutePair(text) {
  const body = remainSource(text);
  const matched = body.match(/(\d{2})分(\d{2})/);
  if (!matched) return null;
  const minutes = Number(matched[1]);
  const seconds = Number(matched[2]);
  if (minutes > 59 || seconds > 59) return null;
  return { hours: 0, minutes, seconds, marked: /秒/.test(body) };
}

// One page mode often drops 剩 while the other still has it. A minute line with
// no 剩 is kept only when both modes name the same two-digit minutes and seconds,
// so a single flipped digit such as 6 read as 7 cannot get through. One of the
// two reads must still contain 秒, so a bare digit run cannot confirm the pair.
export function chooseMeadowPair(first, second) {
  return chooseMeadowRead(first)
    || chooseMeadowRead(second)
    || agreedMinute(first, second);
}

function agreedMinute(first, second) {
  const left = minutePair(first);
  const right = minutePair(second);
  if (!left || !right || (!left.marked && !right.marked)) return null;
  if (left.minutes !== right.minutes || left.seconds !== right.seconds) return null;
  return { hours: 0, minutes: left.minutes, seconds: left.seconds };
}

// Glyphs read one at a time can name a minute line the whole-line reader splits
// into 6 or 7. Only a minutes mark plus a two-digit second group is kept.
export function chooseGlyphMinute(text) {
  const matched = remainSource(text).match(/^(\d{1,2})分(\d{2})秒?$/);
  if (!matched) return null;
  const minutes = Number(matched[1]);
  const seconds = Number(matched[2]);
  if (minutes > 59 || seconds > 59) return null;
  return { hours: 0, minutes, seconds };
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

function oneCharacterApart(left, right) {
  if (left.length !== right.length) return -1;
  let index = -1;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] === right[i]) continue;
    if (index >= 0) return -1;
    index = i;
  }
  return index;
}

// Several reads of one pill. A two-character fragment such as 也六 must not beat
// a longer name from another pass. A binarized pass drops the thin strokes of a
// complex character and then reports the simpler character with higher
// confidence (臻 read as 至). When the two strings differ by that one character
// and the confidences are close, keep the heavier character.
export function choosePlaceName(reads, weightOf = () => 0) {
  const pool = [];
  (reads || []).forEach((read) => {
    const place = readPlace(read?.place || read?.text);
    const confidence = Number(read?.confidence) || 0;
    if (!place) return;
    const found = pool.find((item) => item.place === place);
    if (!found) pool.push({ place, confidence });
    else if (confidence > found.confidence) found.confidence = confidence;
  });
  if (!pool.length) return "";
  const longest = pool.reduce((max, read) => Math.max(max, read.place.length), 0);
  const credible = pool.some((read) => read.place.length === longest && read.confidence >= 40);
  const kept = pool.filter((read) => !credible || longest - read.place.length < 2);
  kept.sort((left, right) => right.confidence - left.confidence);
  const leader = kept[0];
  let chosen = leader;
  let chosenInk = 0;
  let chosenIndex = -1;
  kept.forEach((rival) => {
    if (leader.confidence - rival.confidence > 40) return;
    const index = oneCharacterApart(leader.place, rival.place);
    if (index < 0 || (chosenIndex >= 0 && index !== chosenIndex)) return;
    const leaderInk = weightOf(leader.place[index]);
    const rivalInk = weightOf(rival.place[index]);
    if (leaderInk <= 0 || rivalInk < leaderInk * 1.12) return;
    if (rivalInk <= chosenInk) return;
    chosen = rival;
    chosenInk = rivalInk;
    chosenIndex = index;
  });
  return chosen.place;
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

const KIND_SIZES = ["巨大", "一般", "小型", "大型", "大", "小"];

// The title is already large type. Stretching it toward 168px with nearest
// neighbor splits 菇. A line this tall stays at its own size. A shorter crop
// may grow smoothly, and only up to twice its height.
export function kindScaleFactor(height) {
  const px = Number(height);
  if (!Number.isFinite(px) || px <= 0 || px >= 64) return 1;
  return Math.min(2, 96 / px);
}

// The bold line under the photo names the mushroom that was just fought.
// A description sentence from the next line is not that title.
export function readMushroomKind(text) {
  const lines = String(text || "").split(/[\n\r]+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const han = line.replace(/[^\u4e00-\u9fff]/g, "");
    if (!han.includes("菇") || han.length < 3 || han.length > 12) continue;
    if (/僅|活動|出現|參加|期間|摧毀|擅長|玩具|飾品/.test(han)) continue;
    for (const size of KIND_SIZES) {
      if (han.startsWith(size) && han.length > size.length + 1) {
        return `${size} ${han.slice(size.length)}`;
      }
    }
    return han;
  }
  return "";
}
