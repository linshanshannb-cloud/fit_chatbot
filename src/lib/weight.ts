export type WeightUnit = "kg" | "jin" | "unknown" | null;
export type WeightIntent = "current" | "goal" | "any";

export type NormalizedWeightResult = {
  weightKg: number | null;
  rawValue: number | null;
  rawWeight: number | null;
  unit: WeightUnit;
  confidence: "high" | "medium" | "low";
  needConfirm: boolean;
  needsConfirmation: boolean;
  reason?: string;
};

export type OnboardingWeightFields = {
  weight_kg: number | null;
  goal_weight_kg: number | null;
};

type WeightMention = {
  rawValue: number;
  unit: WeightUnit;
  index: number;
  negated: boolean;
  intent: Exclude<WeightIntent, "any"> | "unknown";
};

const ignoredUnits = new Set([
  "cm",
  "厘米",
  "岁",
  "分钟",
  "分",
  "毫升",
  "ml",
  "ML",
  "升",
  "L",
  "%",
  "％",
]);

const weightMentionPattern =
  /(\d+(?:\.\d+)?)\s*(kg|KG|公斤|千克|斤|cm|厘米|岁|分钟|分|毫升|ml|ML|升|L|%|％)?/g;

function roundWeight(value: number) {
  return Number(value.toFixed(1));
}

function toNumberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeUnit(unit: string | null | undefined): WeightUnit {
  if (!unit) return null;
  const normalized = unit.toLowerCase();
  if (normalized === "kg" || unit === "公斤" || unit === "千克") return "kg";
  if (unit === "斤") return "jin";
  if (ignoredUnits.has(unit)) return "unknown";
  return null;
}

function createResult({
  weightKg,
  rawValue,
  unit,
  confidence,
  needConfirm,
  reason,
}: Omit<NormalizedWeightResult, "rawWeight" | "needsConfirmation">) {
  return {
    weightKg,
    rawValue,
    rawWeight: rawValue,
    unit,
    confidence,
    needConfirm,
    needsConfirmation: needConfirm,
    reason,
  };
}

export function normalizeWeight(
  rawWeight: number | null,
  unit: WeightUnit | "公斤" | "千克" | "斤",
  userHistoryWeight: number | null,
): NormalizedWeightResult {
  const normalizedUnit =
    unit === "公斤" || unit === "千克" ? "kg" : unit === "斤" ? "jin" : unit;

  if (rawWeight === null || !Number.isFinite(rawWeight)) {
    return createResult({
      weightKg: null,
      rawValue: null,
      unit: normalizedUnit,
      confidence: "low",
      needConfirm: false,
      reason: "No weight value was provided.",
    });
  }

  if (normalizedUnit === "jin") {
    return createResult({
      weightKg: roundWeight(rawWeight / 2),
      rawValue: rawWeight,
      unit: "jin",
      confidence: "high",
      needConfirm: false,
      reason: "Explicit jin unit.",
    });
  }

  if (normalizedUnit === "kg") {
    return createResult({
      weightKg: roundWeight(rawWeight),
      rawValue: rawWeight,
      unit: "kg",
      confidence: "high",
      needConfirm: false,
      reason: "Explicit kg unit.",
    });
  }

  if (rawWeight > 140) {
    const jinAsKg = rawWeight / 2;
    const historySuggestsJin =
      userHistoryWeight !== null &&
      userHistoryWeight >= 80 &&
      userHistoryWeight <= 120 &&
      jinAsKg >= 30 &&
      jinAsKg <= 200;

    if (historySuggestsJin) {
      return createResult({
        weightKg: roundWeight(jinAsKg),
        rawValue: rawWeight,
        unit: "jin",
        confidence: "medium",
        needConfirm: false,
        reason: "No unit, inferred jin from recent body weight.",
      });
    }

    return createResult({
      weightKg: null,
      rawValue: rawWeight,
      unit: "unknown",
      confidence: "low",
      needConfirm: true,
      reason: "No unit and the value is ambiguous.",
    });
  }

  return createResult({
    weightKg: roundWeight(rawWeight),
    rawValue: rawWeight,
    unit: "unknown",
    confidence: "medium",
    needConfirm: false,
    reason: "No unit, accepted as kg within normal kg range.",
  });
}

function detectMentionIntent(
  input: string,
  index: number,
): WeightMention["intent"] {
  const before = input.slice(Math.max(0, index - 12), index);
  const after = input.slice(index, Math.min(input.length, index + 12));
  const context = `${before}${after}`;

  if (/(目标|目标体重|减到|想到|想要|希望|计划)/.test(before)) {
    return "goal";
  }

  if (/(体重|当前|初始|现在|空腹|称重|称了|瘦到|胖到|重了|轻了)/.test(context)) {
    return "current";
  }

  return "unknown";
}

function extractWeightMentions(input: string): WeightMention[] {
  return Array.from(input.matchAll(weightMentionPattern))
    .map((match): WeightMention | null => {
      const rawValue = Number(match[1]);
      const rawUnit = match[2] ?? null;
      const unit = normalizeUnit(rawUnit);
      const index = match.index ?? 0;

      if (!Number.isFinite(rawValue) || unit === "unknown") return null;

      return {
        rawValue,
        unit,
        index,
        negated: /(?:不是|并非|不为)$/.test(
          input.slice(Math.max(0, index - 6), index),
        ),
        intent: detectMentionIntent(input, index),
      };
    })
    .filter((mention): mention is WeightMention => mention !== null);
}

function chooseMention({
  mentions,
  intent,
  allowUncontextualized,
  modelWeightKg,
}: {
  mentions: WeightMention[];
  intent: WeightIntent;
  allowUncontextualized: boolean;
  modelWeightKg: number | null;
}) {
  const activeMentions = mentions.filter((mention) => !mention.negated);
  const candidates = activeMentions.length > 0 ? activeMentions : mentions;
  const contextual =
    intent === "any"
      ? candidates
      : candidates.filter((mention) => mention.intent === intent);
  const uncontextualized =
    intent === "any" || !allowUncontextualized
      ? []
      : candidates.filter((mention) => mention.intent === "unknown");
  const pool = contextual.length > 0 ? contextual : uncontextualized;

  if (pool.length === 0) return null;

  const explicit = [...pool].reverse().find((mention) => mention.unit !== null);
  if (explicit) return explicit;

  if (pool.length === 1 || modelWeightKg === null) {
    return pool[pool.length - 1];
  }

  const exactModelMatch = pool.find(
    (mention) => Math.abs(mention.rawValue - modelWeightKg) < 0.2,
  );
  if (exactModelMatch) return exactModelMatch;

  const probableTruncation = pool.find(
    (mention) =>
      mention.rawValue > 140 &&
      Math.round(mention.rawValue % 100) === Math.round(modelWeightKg),
  );
  if (probableTruncation) return probableTruncation;

  return pool[pool.length - 1];
}

export function normalizeWeightFromText({
  input,
  modelWeightKg,
  userHistoryWeight,
  intent = "any",
  allowUncontextualized = true,
  useModelFallback = true,
}: {
  input: string;
  modelWeightKg: number | null;
  userHistoryWeight: number | null;
  intent?: WeightIntent;
  allowUncontextualized?: boolean;
  useModelFallback?: boolean;
}): NormalizedWeightResult {
  const mentions = extractWeightMentions(input);
  const mention = chooseMention({
    mentions,
    intent,
    allowUncontextualized,
    modelWeightKg,
  });

  if (mention) {
    return normalizeWeight(mention.rawValue, mention.unit, userHistoryWeight);
  }

  if (!useModelFallback) {
    return createResult({
      weightKg: null,
      rawValue: null,
      unit: null,
      confidence: "low",
      needConfirm: false,
      reason: "No matching weight mention in text.",
    });
  }

  return normalizeWeight(modelWeightKg, null, userHistoryWeight);
}

export function applyOnboardingWeightHints<T extends OnboardingWeightFields>({
  input,
  currentDraft,
  extractedProfile,
  userHistoryWeight = null,
}: {
  input: string;
  currentDraft: T;
  extractedProfile: T;
  userHistoryWeight?: number | null;
}) {
  const nextProfile = { ...currentDraft } as T;

  (Object.keys(extractedProfile) as Array<keyof T>).forEach((field) => {
    const value = extractedProfile[field];
    if (value !== null && value !== "") {
      nextProfile[field] = value;
    }
  });

  const historyWeight =
    toNumberOrNull(currentDraft.weight_kg) ??
    toNumberOrNull(extractedProfile.weight_kg) ??
    userHistoryWeight;
  const missingCurrent = toNumberOrNull(currentDraft.weight_kg) === null;
  const missingGoal = toNumberOrNull(currentDraft.goal_weight_kg) === null;

  const currentWeight = normalizeWeightFromText({
    input,
    modelWeightKg: toNumberOrNull(extractedProfile.weight_kg),
    userHistoryWeight: historyWeight,
    intent: "current",
    allowUncontextualized: missingCurrent || !missingGoal,
    useModelFallback: false,
  });
  const goalWeight = normalizeWeightFromText({
    input,
    modelWeightKg: toNumberOrNull(extractedProfile.goal_weight_kg),
    userHistoryWeight: historyWeight,
    intent: "goal",
    allowUncontextualized: missingGoal && !missingCurrent,
    useModelFallback: false,
  });

  if (!currentWeight.needConfirm && currentWeight.weightKg !== null) {
    nextProfile.weight_kg = currentWeight.weightKg as T["weight_kg"];
  }

  if (!goalWeight.needConfirm && goalWeight.weightKg !== null) {
    nextProfile.goal_weight_kg = goalWeight.weightKg as T["goal_weight_kg"];
  }

  return nextProfile;
}
