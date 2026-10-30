import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanLocation, parseRemaining, parseScreenshotText, readPlace } from "../js/parse.js";

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
    assert.equal(cleanLocation("  名人鄉村小公園 > "), "名人鄉村小公園");
    assert.equal(readPlace("名 人 鄉村 小 公園 > |"), "名人鄉村小公園");
    assert.equal(readPlace("名人鄉村小公園》4"), "名人鄉村小公園");
    assert.equal(readPlace("巨大 萬聖節蘑菇"), "");
  });
});
