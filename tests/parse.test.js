import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanLocation, parseDigitRun, parseRemaining, parseScreenshotText, parseSplitDigits, readPlace } from "../js/parse.js";

describe("destruction time", () => {
  it("reads the red remaining line and ignores the mushroom title", () => {
    const parsed = parseScreenshotText({
      text: "1:18\n名人鄉村小公園 >\n剩下3小時32分28秒\n巨大 萬聖節蘑菇",
      width: 400,
      height: 900,
      lines: [
        { text: "1:18", bbox: { x0: 8, y0: 10, x1: 70, y1: 36 } },
        { text: "名人鄉村小公園 >", bbox: { x0: 90, y0: 80, x1: 280, y1: 120 } },
        { text: "剩下3小時32分28秒", bbox: { x0: 20, y0: 360, x1: 260, y1: 400 } },
        { text: "巨大 萬聖節蘑菇", bbox: { x0: 40, y0: 520, x1: 300, y1: 570 } }
      ]
    });
    assert.equal(parsed.location, "名人鄉村小公園");
    assert.deepEqual(parsed.remaining, { hours: 3, minutes: 32, seconds: 28 });
    assert.deepEqual(parsed.clock, { hour: 1, minute: 18, meridiem: null });
  });

  it("still ignores a mushroom name that was read near the top", () => {
    const parsed = parseScreenshotText({
      text: "巨大萬聖節蘑菇",
      width: 400,
      height: 800,
      lines: [
        { text: "巨大 萬聖節蘑菇", bbox: { x0: 40, y0: 90, x1: 280, y1: 130 } }
      ]
    });
    assert.equal(parsed.location, "");
  });

  it("reads a shorter remaining time", () => {
    assert.deepEqual(parseRemaining("剩下12分05秒"), { hours: 0, minutes: 12, seconds: 5 });
    assert.deepEqual(parseRemaining("剩下18分32秒"), { hours: 0, minutes: 18, seconds: 32 });
    assert.deepEqual(parseRemaining("剩31分6秒"), { hours: 0, minutes: 31, seconds: 6 });
    assert.deepEqual(parseRemaining("31分06秒"), { hours: 0, minutes: 31, seconds: 6 });
    assert.deepEqual(parseRemaining("剩下12秒"), { hours: 0, minutes: 0, seconds: 12 });
    assert.equal(parseRemaining("剩下18532秒"), null);
    assert.deepEqual(parseSplitDigits("剩18分", "1832"), { hours: 0, minutes: 18, seconds: 32 });
    assert.deepEqual(parseSplitDigits("31分", "316"), { hours: 0, minutes: 31, seconds: 6 });
    assert.deepEqual(parseDigitRun("3106", "剩下"), { hours: 0, minutes: 31, seconds: 6 });
    assert.deepEqual(parseDigitRun("15918", "剩下"), { hours: 1, minutes: 59, seconds: 18 });
    assert.equal(parseDigitRun("405625", "405,625"), null);
    assert.equal(parseSplitDigits("剩18分", "187832"), null);
    assert.equal(parseRemaining("AVES 小時32 分 28 秒"), null);
    assert.deepEqual(parseRemaining("剩下3 小時 32 分 28 秒"), { hours: 3, minutes: 32, seconds: 28 });
    assert.equal(cleanLocation("  名人鄉村小公園 > "), "名人鄉村小公園");
    assert.equal(readPlace("名 人 鄉村 小 公園 > |"), "名人鄉村小公園");
    assert.equal(readPlace("名人鄉村小公園》4"), "名人鄉村小公園");
    assert.equal(readPlace("巨大 萬聖節蘑菇"), "");
  });
});
