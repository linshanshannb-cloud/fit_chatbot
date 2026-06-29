export type BodyUpdateSubject =
  | "self"
  | "other"
  | "goal"
  | "history"
  | "uncertain";

export type BodyUpdateDecision = {
  is_body_update: boolean;
  subject: BodyUpdateSubject;
  should_save: boolean;
  reason: string;
};

const otherSubjectPattern =
  /(朋友|同事|同学|家人|别人|其他人|我爸|我妈|爸爸|妈妈|父亲|母亲|老婆|老公|女朋友|男朋友|对象|张三|李四|孙策|他说|她说|他们说|她今天|他今天|他现在|她现在)/;
const goalPattern = /(目标体重|目标是|目标|希望|想减到|想瘦到|减到|瘦到.*会怎么样|到\d+(?:\.\d+)?\s*(?:kg|公斤|千克|斤)?会怎么样)/;
const historyPattern = /(以前|之前|过去|去年|前年|上个月|上周|那时候|曾经|原来)/;
const hypotheticalPattern = /(如果|假如|要是|会怎么样|怎么办)/;

export function guardBodyUpdateDecision<T extends BodyUpdateDecision>(
  input: string,
  decision: T,
): T {
  if (!decision.is_body_update) {
    return {
      ...decision,
      should_save: false,
    };
  }

  if (otherSubjectPattern.test(input)) {
    return {
      ...decision,
      subject: "other",
      should_save: false,
      reason: "用户提到的是朋友、家人或其他明确第三方的身体数据",
    };
  }

  if (historyPattern.test(input)) {
    return {
      ...decision,
      subject: "history",
      should_save: false,
      reason: "用户描述的是历史身体数据，不是本次更新",
    };
  }

  if (hypotheticalPattern.test(input) || goalPattern.test(input)) {
    return {
      ...decision,
      subject: "goal",
      should_save: false,
      reason: "用户描述的是目标、愿望或假设，不是当前身体数据",
    };
  }

  if (decision.subject !== "self" || decision.should_save !== true) {
    return {
      ...decision,
      should_save: false,
    };
  }

  return decision;
}
