import assert from "node:assert/strict";
import test from "node:test";
import {
  createCheckinPatchFromExtraction,
  hasCheckinPatch,
  shouldIgnoreCheckinInput,
  type CheckinExtraction,
} from "../src/lib/daily-checkin.ts";

const emptyExtraction: CheckinExtraction = {
  has_checkin_info: false,
  weight: null,
  strength_done: null,
  strength_part: null,
  cardio_done: null,
  cardio_type: null,
  cardio_duration: null,
  water_status: null,
  diet_status: null,
  protein_status: null,
};

test("creates daily checkin patch from extracted training and nutrition", () => {
  const patch = createCheckinPatchFromExtraction({
    ...emptyExtraction,
    has_checkin_info: true,
    strength_done: true,
    strength_part: "腿部",
    cardio_done: true,
    cardio_type: "动感单车",
    cardio_duration: 30,
    water_status: "low",
    protein_status: "good",
    diet_status: "good",
  });

  assert.equal(patch.strength_done, true);
  assert.equal(patch.strength_part, "腿部");
  assert.equal(patch.cardio_done, true);
  assert.equal(patch.cardio_type, "动感单车");
  assert.equal(patch.cardio_duration, 30);
  assert.equal(patch.water_status, "low");
  assert.equal(patch.protein_status, "good");
  assert.equal(patch.diet_status, "good");
  assert.equal(hasCheckinPatch(patch), true);
});

test("ignores third party and hypothetical checkin text", () => {
  assert.equal(shouldIgnoreCheckinInput("张三今天练腿了"), true);
  assert.equal(shouldIgnoreCheckinInput("我朋友跑了30分钟"), true);
  assert.equal(shouldIgnoreCheckinInput("如果我今天练腿会怎么样？"), true);
  assert.equal(shouldIgnoreCheckinInput("今天练腿了"), false);
});
