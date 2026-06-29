import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeWeight,
  normalizeWeightFromText,
} from "../src/lib/weight-normalization.ts";

test("normalizes explicit weight units", () => {
  assert.equal(normalizeWeight(183, "斤", null).weightKg, 91.5);
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
