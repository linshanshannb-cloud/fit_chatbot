import assert from "node:assert/strict";
import test from "node:test";
import {
  guardBodyUpdateDecision,
  type BodyUpdateDecision,
} from "../src/lib/body-update-guard.ts";

const baseDecision: BodyUpdateDecision = {
  is_body_update: true,
  subject: "self",
  should_save: true,
  reason: "测试默认判定为本人身体数据",
};

const allowedCases = [
  "今天我的体重是100kg",
  "我今天100kg",
  "今天体重100kg",
  "早上空腹100.5kg",
  "腰围92cm",
  "我瘦到95kg了",
];

const blockedCases: Array<{
  input: string;
  subject: BodyUpdateDecision["subject"];
}> = [
  { input: "我朋友今天体重180斤", subject: "other" },
  { input: "孙策今天体重200斤", subject: "other" },
  { input: "孙策（我的朋友）今天体重200斤", subject: "other" },
  { input: "我爸今天体重80kg", subject: "other" },
  { input: "我女朋友今天瘦到50kg", subject: "other" },
  { input: "张三说他今天100kg", subject: "other" },
  { input: "别人体重是90kg", subject: "other" },
  { input: "我希望减到85kg", subject: "goal" },
  { input: "目标体重85kg", subject: "goal" },
  { input: "我以前100kg", subject: "history" },
  { input: "去年我120kg", subject: "history" },
  { input: "如果我到90kg会怎么样", subject: "goal" },
];

test("allows current user's body updates", () => {
  for (const input of allowedCases) {
    const decision = guardBodyUpdateDecision(input, baseDecision);

    assert.equal(decision.is_body_update, true, input);
    assert.equal(decision.subject, "self", input);
    assert.equal(decision.should_save, true, input);
  }
});

test("blocks other people, goals, history and hypothetical data", () => {
  for (const { input, subject } of blockedCases) {
    const decision = guardBodyUpdateDecision(input, baseDecision);

    assert.equal(decision.is_body_update, true, input);
    assert.equal(decision.subject, subject, input);
    assert.equal(decision.should_save, false, input);
  }
});
