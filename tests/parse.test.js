import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chooseGlyphMinute, chooseMeadowPair, chooseMeadowRead, choosePlaceName, cleanLocation, chooseRemainingRead, kindScaleFactor, matchClock, parseDigitRun, parseRemaining, parseScreenshotText, parseSplitDigits, readMushroomKind, readPlace } from "../js/parse.js";

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
    assert.deepEqual(matchClock("11:107"), { hour: 11, minute: 10, meridiem: null });
    assert.deepEqual(matchClock("11:10 1:27"), { hour: 11, minute: 10, meridiem: null });
    assert.equal(parseRemaining("AVES 小時32 分 28 秒"), null);
    assert.deepEqual(parseRemaining("剩下3 小時 32 分 28 秒"), { hours: 3, minutes: 32, seconds: 28 });
    assert.deepEqual(parseRemaining("下10小時9分20"), { hours: 10, minutes: 9, seconds: 20 });
    assert.equal(parseRemaining("下10小時9分204"), null);
    assert.equal(cleanLocation("  名人鄉村小公園 > "), "名人鄉村小公園");
    assert.equal(readPlace("名 人 鄉村 小 公園 > |"), "名人鄉村小公園");
    assert.equal(readPlace("名人鄉村小公園》4"), "名人鄉村小公園");
    assert.equal(readPlace("巨大 萬聖節蘑菇"), "");
    assert.equal(readPlace("土銀花埔。"), "土銀花埔");
    assert.equal(readPlace("TERESA"), "");
    assert.deepEqual(parseRemaining("644,051剩下1小時26分21秒"), { hours: 1, minutes: 26, seconds: 21 });
    assert.deepEqual(parseRemaining("血量 405625 剩下31分06秒"), { hours: 0, minutes: 31, seconds: 6 });
    assert.equal(parseRemaining("644,051"), null);
    assert.deepEqual(parseRemaining("剩下57分34"), { hours: 0, minutes: 57, seconds: 34 });
    assert.deepEqual(parseRemaining("剩下57分鐘34秒"), { hours: 0, minutes: 57, seconds: 34 });
    assert.deepEqual(parseRemaining("下57分34"), { hours: 0, minutes: 57, seconds: 34 });
    assert.deepEqual(parseRemaining("下6分47"), { hours: 0, minutes: 6, seconds: 47 });
    assert.equal(parseRemaining("下5分6"), null);
    assert.deepEqual(parseRemaining("剩下57份34妙"), { hours: 0, minutes: 57, seconds: 34 });
    assert.deepEqual(parseRemaining("剩下3小时2分32秒"), { hours: 3, minutes: 2, seconds: 32 });
    assert.equal(parseRemaining("57分34"), null);
    assert.equal(parseRemaining("剩下5734"), null);
    const same = { hours: 0, minutes: 57, seconds: 34 };
    assert.deepEqual(chooseRemainingRead([
      { text: "剩下57分34秒" },
      { text: "剩下51分34秒" }
    ]), null);
    assert.deepEqual(chooseRemainingRead([
      { text: "剩下57分34秒" },
      { text: "剩下57分34秒" },
      { text: "剩下51分34秒" }
    ]), same);
    assert.deepEqual(chooseRemainingRead([
      { text: "剩下57分34秒" },
      { text: "57分38", open: true }
    ]), same);
    assert.deepEqual(chooseRemainingRead([
      { text: "下18分32秒" },
      { text: "MT18 分32 秒", open: true },
      { text: "下8分32秒" },
      { text: "剩下18分32秒" },
      { text: "剩下8分32秒" }
    ]), { hours: 0, minutes: 18, seconds: 32 });
    assert.deepEqual(chooseRemainingRead([
      { text: "剩丁", open: true }
    ], "5734", "剩下"), same);
  });

  it("keeps a meadow hour line and refuses a minute digit that lost 剩下", () => {
    assert.deepEqual(chooseMeadowRead("下1小時28分8秒"), { hours: 1, minutes: 28, seconds: 8 });
    assert.deepEqual(chooseMeadowRead("下1小時28分8"), { hours: 1, minutes: 28, seconds: 8 });
    assert.deepEqual(chooseMeadowRead("剩下6分47秒"), { hours: 0, minutes: 6, seconds: 47 });
    assert.equal(chooseMeadowRead("下7分47秒"), null);
    assert.equal(chooseMeadowRead("下6分47秒"), null);
    assert.equal(chooseMeadowRead("下分47秒"), null);
    assert.equal(chooseMeadowRead("47"), null);
    assert.equal(chooseMeadowRead("下3228分8"), null);
    assert.equal(chooseMeadowRead("剩下小時28分8秒"), null);
  });

  it("keeps a meadow minute when the other mode still has 剩下, and only agrees on two digits", () => {
    assert.deepEqual(chooseMeadowPair("下10分55秒", "剩下10分55秒"), { hours: 0, minutes: 10, seconds: 55 });
    assert.deepEqual(chooseMeadowPair("下29分46秒", "下29分46秒"), { hours: 0, minutes: 29, seconds: 46 });
    assert.deepEqual(chooseMeadowPair("下59分56", "下59分56秒"), { hours: 0, minutes: 59, seconds: 56 });
    assert.equal(chooseMeadowPair("下59分56", "下59分56"), null);
    assert.equal(chooseMeadowPair("下29分45秒", "29346"), null);
    assert.equal(chooseMeadowPair("下7分47秒", "下7分47秒"), null);
    assert.equal(chooseMeadowPair("下6分47秒", "下7分47秒"), null);
    assert.equal(chooseMeadowPair("下5分6", "2946"), null);
  });

  it("keeps a glyph minute only when the seconds are two digits", () => {
    assert.deepEqual(chooseGlyphMinute("6分47"), { hours: 0, minutes: 6, seconds: 47 });
    assert.deepEqual(chooseGlyphMinute("6分47秒"), { hours: 0, minutes: 6, seconds: 47 });
    assert.equal(chooseGlyphMinute("6分7"), null);
    assert.equal(chooseGlyphMinute("下7分47秒"), null);
    assert.equal(chooseGlyphMinute("647"), null);
  });
});

describe("place name", () => {
  const weight = (char) => ({
    臻: 2334,
    至: 1938,
    主: 1482,
    大: 1288,
    太: 1354
  })[char] || 0;

  it("does not let a short confident fragment replace a longer name", () => {
    assert.equal(choosePlaceName([
      { text: "也六", confidence: 92 },
      { text: "“浮生臻品", confidence: 51 }
    ], weight), "浮生臻品");
  });

  it("keeps a real two-character name when nothing longer was read", () => {
    assert.equal(choosePlaceName([
      { text: "也六", confidence: 92 },
      { text: "浮生臻品", confidence: 20 }
    ], weight), "也六");
    assert.equal(choosePlaceName([{ text: "公園", confidence: 80 }], weight), "公園");
  });

  it("keeps the heavier character when a thinner copy scores higher", () => {
    assert.equal(choosePlaceName([
      { text: "浮生臻品", confidence: 51 },
      { text: "浮生至品", confidence: 67 },
      { text: "浮生主品", confidence: 54 }
    ], weight), "浮生臻品");
    assert.equal(choosePlaceName([
      { text: "浮生臻品", confidence: 84 },
      { text: "浮生至品", confidence: 69 }
    ], weight), "浮生臻品");
  });

  it("does not replace 大 with the slightly heavier 太", () => {
    assert.equal(choosePlaceName([
      { text: "大樓藝術裝置", confidence: 95 },
      { text: "太樓藝術裝置", confidence: 89 }
    ], weight), "大樓藝術裝置");
  });

  it("returns nothing when every read is rejected", () => {
    assert.equal(choosePlaceName([
      { text: "參加", confidence: 80 },
      { text: "SEA", confidence: 70 }
    ], weight), "");
  });
});

describe("mushroom kind", () => {
  it("keeps the bold title and puts the size in front", () => {
    assert.equal(readMushroomKind("一般 輝煌蘑菇"), "一般 輝煌蘑菇");
    assert.equal(readMushroomKind("一般輝煌蘑菇"), "一般 輝煌蘑菇");
    assert.equal(readMushroomKind("巨大 萬聖節蘑菇"), "巨大 萬聖節蘑菇");
  });

  it("drops the description under the title", () => {
    assert.equal(readMushroomKind("輝煌蘑菇僅在活動期間出現。"), "");
    assert.equal(readMushroomKind("一般 輝煌蘑菇\n輝煌蘑菇僅在活動期間出現。"), "一般 輝煌蘑菇");
    assert.equal(readMushroomKind(""), "");
  });

  it("leaves a tall title line alone and only doubles a short one", () => {
    assert.equal(kindScaleFactor(47), 2);
    assert.equal(kindScaleFactor(32), 2);
    assert.equal(kindScaleFactor(80), 1);
    assert.equal(kindScaleFactor(168), 1);
    assert.equal(kindScaleFactor(0), 1);
    assert.ok(Math.abs(kindScaleFactor(50) - 1.92) < 0.001);
  });
});
