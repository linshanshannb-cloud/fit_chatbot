import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOnboardingWeightHints,
  normalizeWeight,
  normalizeWeightFromText,
} from "../src/lib/weight.ts";
import { resolveOnboardingNumericInput } from "../src/lib/onboarding-numeric.ts";

test("normalizes explicit weight units", () => {
  assert.equal(normalizeWeight(183, "jin", null).weightKg, 91.5);
  assert.equal(normalizeWeight(91.5, "kg", null).weightKg, 91.5);
  assert.equal(normalizeWeight(92.3, "公斤", null).weightKg, 92.3);
  assert.equal(normalizeWeight(92.3, "千克", null).weightKg, 92.3);
});

test("infers unitless large weight as jin from historical weight", () => {
  const result = normalizeWeightFromText({
    input: "我刚称了一下体重，吃完晚饭现在是183",
    modelWeightKg: 83,
    userHistoryWeight: 90,
  });

  assert.equal(result.needsConfirmation, false);
  assert.equal(result.weightKg, 91.5);
});

test("asks for confirmation when unitless large weight is ambiguous", () => {
  const result = normalizeWeightFromText({
    input: "我刚称了一下，183",
    modelWeightKg: 183,
    userHistoryWeight: null,
  });

  assert.equal(result.needsConfirmation, true);
  assert.equal(result.weightKg, null);
});

test("does not truncate ordinary kg values", () => {
  assert.equal(
    normalizeWeightFromText({
      input: "今天体重101",
      modelWeightKg: 101,
      userHistoryWeight: 100,
    }).weightKg,
    101,
  );
  assert.equal(
    normalizeWeightFromText({
      input: "早上空腹99.5",
      modelWeightKg: 99.5,
      userHistoryWeight: 100,
    }).weightKg,
    99.5,
  );
});

test("uses corrected value and skips negated values", () => {
  assert.equal(
    normalizeWeightFromText({
      input: "不是83公斤，是183斤",
      modelWeightKg: 83,
      userHistoryWeight: 90,
    }).weightKg,
    91.5,
  );

  assert.equal(
    normalizeWeightFromText({
      input: "我说我现在的体重是183斤，不是83公斤",
      modelWeightKg: 83,
      userHistoryWeight: 90,
    }).weightKg,
    91.5,
  );
});

type TestDraft = {
  nickname: string | null;
  sex: string | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  waist_cm: number | null;
  goal_weight_kg: number | null;
  training_frequency: string | null;
};

const emptyDraft: TestDraft = {
  nickname: null,
  sex: null,
  age: null,
  height_cm: null,
  weight_kg: null,
  waist_cm: null,
  goal_weight_kg: null,
  training_frequency: null,
};

test("fills current weight first, then goal weight in multi-turn onboarding", () => {
  const firstDraft: TestDraft = {
    ...emptyDraft,
    nickname: "富婆",
    sex: "female",
    age: 39,
    height_cm: 160,
  };

  const afterCurrent = applyOnboardingWeightHints({
    input: "120斤",
    currentDraft: firstDraft,
    extractedProfile: emptyDraft,
  });

  assert.equal(afterCurrent.weight_kg, 60);
  assert.equal(afterCurrent.goal_weight_kg, null);
  assert.equal(afterCurrent.nickname, "富婆");
  assert.equal(afterCurrent.height_cm, 160);

  const afterGoal = applyOnboardingWeightHints({
    input: "100斤",
    currentDraft: afterCurrent,
    extractedProfile: emptyDraft,
  });

  assert.equal(afterGoal.weight_kg, 60);
  assert.equal(afterGoal.goal_weight_kg, 50);
});

test("separates current and goal weight in one onboarding message", () => {
  const result = applyOnboardingWeightHints({
    input: "富婆，女，39岁，身高160，120斤，目标100斤",
    currentDraft: emptyDraft,
    extractedProfile: {
      ...emptyDraft,
      nickname: "富婆",
      sex: "female",
      age: 39,
      height_cm: 160,
    },
  });

  assert.equal(result.weight_kg, 60);
  assert.equal(result.goal_weight_kg, 50);
});

test("assigns explicit goal weight to goal field", () => {
  const result = applyOnboardingWeightHints({
    input: "目标体重120斤",
    currentDraft: emptyDraft,
    extractedProfile: emptyDraft,
  });

  assert.equal(result.weight_kg, null);
  assert.equal(result.goal_weight_kg, 60);
});

test("asks confirmation for bare number when multiple numeric onboarding fields are missing", () => {
  const result = resolveOnboardingNumericInput({
    input: "29",
    currentDraft: {
      age: null,
      height_cm: null,
      weight_kg: 87.5,
      goal_weight_kg: null,
    },
  });

  assert.equal(result.type, "confirm");
  assert.equal(result.confidence, 0);
  assert.deepEqual(result.patch, {});
  assert.match(result.message ?? "", /29/);
  assert.match(result.message ?? "", /年龄/);
  assert.match(result.message ?? "", /目标体重/);
});

test("records bare number directly when only one numeric onboarding field is missing", () => {
  const result = resolveOnboardingNumericInput({
    input: "29",
    currentDraft: {
      age: null,
      height_cm: 175,
      weight_kg: 87.5,
      goal_weight_kg: 75,
    },
  });

  assert.equal(result.type, "patch");
  assert.deepEqual(result.patch, { age: 29 });
});
