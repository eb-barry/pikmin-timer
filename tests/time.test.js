import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyReading,
  canStart,
  classifyDrafts,
  describeDraft,
  draftToRespawn,
  formatClock,
  formatCountdown,
  meridiemLabel,
  shiftAnchor,
  splitBoard,
  suggestAnchor,
  toggleMeridiem
} from "../js/time.js";

const at = (h, m, s = 0, day = 30) => new Date(2026, 9, day, h, m, s);

describe("respawn math", () => {
  it("adds the 4 minute cooldown onto the destruction countdown", () => {
    const respawn = draftToRespawn({
      anchorDate: "2026-10-30",
      anchorTime: "13:18",
      anchorSeconds: 0,
      hours: 3,
      minutes: 32,
      seconds: 28
    }, 4 * 60 * 1000);
    assert.equal(formatClock(respawn), "16:54:28");
    assert.equal(formatCountdown(respawn.getTime() - at(13, 18, 0).getTime()), "03:36:28");
  });

  it("keeps the respawn instant when the screenshot is uploaded late", () => {
    const draft = {
      anchorDate: "2026-10-30",
      anchorTime: "13:18",
      anchorSeconds: 0,
      hours: 3,
      minutes: 32,
      seconds: 28
    };
    const described = describeDraft(draft, 4 * 60 * 1000, at(14, 0, 0));
    assert.equal(described.respawnText, "16:54:28");
    assert.equal(described.countdownText, "02:54:28");
    assert.equal(described.past, false);
  });
});

describe("screenshot clock", () => {
  it("uses the phone clock when the shot was just taken", () => {
    const suggested = suggestAnchor({ hour: 1, minute: 18, now: at(13, 18, 40) });
    assert.equal(suggested.usedNow, true);
    assert.equal(formatClock(suggested.anchor), "13:18:40");
  });

  it("picks 13:18 in the afternoon when the status bar says 1:18", () => {
    const suggested = suggestAnchor({ hour: 1, minute: 18, now: at(16, 0, 0) });
    assert.equal(suggested.usedNow, false);
    assert.equal(formatClock(suggested.anchor, { seconds: false }), "13:18");
  });

  it("picks 1:18 in the early morning", () => {
    const suggested = suggestAnchor({ hour: 1, minute: 18, now: at(2, 0, 0) });
    assert.equal(formatClock(suggested.anchor, { seconds: false }), "01:18");
  });

  it("does not treat a future afternoon mark as the screenshot time", () => {
    const suggested = suggestAnchor({ hour: 1, minute: 18, now: at(12, 30, 0) });
    assert.equal(formatClock(suggested.anchor, { seconds: false }), "01:18");
  });

  it("reads an explicit afternoon mark", () => {
    const suggested = suggestAnchor({ hour: 1, minute: 18, meridiem: "pm", now: at(16, 0, 0) });
    assert.equal(formatClock(suggested.anchor, { seconds: false }), "13:18");
  });

  it("resolves 12:05 just after midnight as 00:05", () => {
    const suggested = suggestAnchor({ hour: 12, minute: 5, now: at(0, 20, 0) });
    assert.equal(formatClock(suggested.anchor, { seconds: false }), "00:05");
  });
});

describe("anchor edits", () => {
  it("flips between morning and afternoon", () => {
    assert.equal(toggleMeridiem("01:18"), "13:18");
    assert.equal(toggleMeridiem("13:18"), "01:18");
    assert.equal(meridiemLabel("13:18"), "改成上午");
    assert.equal(meridiemLabel("01:18"), "改成下午");
  });

  it("shifts across an hour boundary", () => {
    const shifted = shiftAnchor("2026-10-30", "13:18", 28, -20);
    assert.equal(shifted.anchorTime, "12:58");
    assert.equal(shifted.anchorSeconds, 28);
  });
});

describe("slots", () => {
  it("replaces the same place instead of taking another slot", () => {
    const existing = [{ location: "名人鄉村小公園" }, { location: "另一座公園" }];
    const result = classifyDrafts(existing, [{ location: "名人鄉村小公園", remainingReady: true }]);
    assert.deepEqual(result.notes, ["replace"]);
    assert.equal(result.total, 2);
    assert.equal(result.overflow, 0);
    assert.equal(canStart(result, [{ remainingReady: true }]), true);
  });

  it("blocks the seventh mushroom until one is removed", () => {
    const existing = Array.from({ length: 6 }, (_, index) => ({ location: `公園${index}` }));
    const result = classifyDrafts(existing, [{ location: "新公園" }]);
    assert.equal(result.overflow, 1);
    assert.equal(canStart(result, [{ remainingReady: true }]), false);
  });

  it("asks to remove a duplicated row in the same batch", () => {
    const result = classifyDrafts([], [
      { location: "名人鄉村小公園" },
      { location: "名人鄉村小公園" }
    ]);
    assert.deepEqual(result.notes, ["duplicate-lost", "add"]);
    assert.equal(canStart(result, [{ remainingReady: true }, { remainingReady: true }]), false);
  });
});

describe("reading into a draft", () => {
  it("does not overwrite a place the user already edited", () => {
    const draft = {
      location: "我改過",
      locationDirty: true,
      remainingDirty: false,
      anchorDirty: false,
      hours: 0,
      minutes: 0,
      seconds: 0
    };
    applyReading(draft, {
      location: "名人鄉村小公園",
      remaining: { hours: 3, minutes: 32, seconds: 28 },
      clock: { hour: 13, minute: 18, meridiem: null }
    }, at(13, 18, 10));
    assert.equal(draft.location, "我改過");
    assert.equal(draft.hours, 3);
    assert.equal(draft.remainingReady, true);
  });
});

describe("board order", () => {
  it("puts the soonest respawn on the large clock", () => {
    const board = splitBoard([
      { id: "late", respawnAt: 300, createdAt: 1 },
      { id: "soon", respawnAt: 100, createdAt: 2 },
      { id: "mid", respawnAt: 200, createdAt: 3 }
    ]);
    assert.equal(board.hero.id, "soon");
    assert.deepEqual(board.rest.map((timer) => timer.id), ["mid", "late"]);
  });
});
