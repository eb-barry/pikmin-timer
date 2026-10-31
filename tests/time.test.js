import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  alarmOrder,
  applyReading,
  clampCooldown,
  describeDraft,
  draftToRespawn,
  formatClock,
  formatCountdown,
  meridiemLabel,
  nextTimers,
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

describe("cooldown", () => {
  it("allows 1 to 4 minutes with seconds, and locks 5 minutes at 0 seconds", () => {
    assert.deepEqual(clampCooldown(4, 30), { cooldownMin: 4, cooldownSec: 30 });
    assert.deepEqual(clampCooldown(5, 40), { cooldownMin: 5, cooldownSec: 0 });
    assert.deepEqual(clampCooldown(0, 20), { cooldownMin: 1, cooldownSec: 20 });
    assert.deepEqual(clampCooldown(9, 10), { cooldownMin: 5, cooldownSec: 0 });
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

function draft(location, ready = true) {
  return {
    location,
    remainingReady: ready,
    anchorDate: "2026-10-30",
    anchorTime: "13:18",
    anchorSeconds: 0,
    hours: 1,
    minutes: 0,
    seconds: 0
  };
}

describe("placing uploads", () => {
  it("replaces the same place and still starts when the name or countdown is missing", () => {
    const existing = [
      { id: "park", location: "名人鄉村小公園", respawnAt: 1, createdAt: 1 },
      { id: "other", location: "另一座公園", respawnAt: 2, createdAt: 2 }
    ];
    const result = nextTimers(existing, [
      draft("名人鄉村小公園"),
      draft("", false)
    ], 4 * 60 * 1000, 1000, (index) => `new-${index}`);
    assert.equal(result.dropped, 0);
    assert.equal(result.timers.length, 3);
    assert.equal(result.timers[0].id, "park");
    assert.equal(result.timers[0].respawnAt, at(13, 18).getTime() + 60 * 60 * 1000 + 4 * 60 * 1000);
    assert.equal(result.timers[2].location, "");
    assert.equal(result.timers[2].respawnAt, null);
  });

  it("leaves a full board unchanged until one clock is deleted", () => {
    const existing = Array.from({ length: 7 }, (_, index) => ({
      id: `id-${index}`,
      location: `公園${index}`,
      respawnAt: index + 1,
      createdAt: index
    }));
    const result = nextTimers(existing, [draft("新公園")], 0, 1000, () => "new");
    assert.equal(result.dropped, 1);
    assert.equal(result.timers.length, 7);
    assert.equal(result.timers.some((timer) => timer.location === "新公園"), false);
  });

  it("keeps one clock when the same place is read twice", () => {
    const result = nextTimers([], [draft("名人鄉村小公園", false), draft("名人鄉村小公園")], 0, 1000, (index) => `id-${index}`);
    assert.equal(result.timers.length, 1);
    assert.equal(result.timers[0].id, "id-0");
    assert.equal(result.timers[0].respawnAt, at(13, 18).getTime() + 60 * 60 * 1000);
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
    assert.equal(draft.clockReady, true);
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

  it("keeps a clock with no countdown off the alarm list and behind timed clocks", () => {
    const timers = [
      { id: "unknown", location: "", respawnAt: null, createdAt: 1 },
      { id: "soon", location: "公園", respawnAt: 100, createdAt: 2 }
    ];
    const board = splitBoard(timers);
    assert.equal(board.hero.id, "soon");
    assert.equal(board.rest[0].id, "unknown");
    assert.deepEqual(alarmOrder(timers, 150), ["soon"]);
    assert.deepEqual(alarmOrder(timers, 50), []);
  });
});
