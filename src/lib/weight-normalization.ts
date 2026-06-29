export type WeightUnit = "kg" | "公斤" | "千克" | "斤" | null;

export type NormalizedWeightResult = {
  weightKg: number | null;
  needsConfirmation: boolean;
  rawWeight: number | null;
  unit: WeightUnit;
  reason: string;
};

type WeightMention = {
  rawWeight: number;
  unit: WeightUnit;
  index: number;
  negated: boolean;
};

const weightMentionPattern =
  /(\d+(?:\.\d+)?)\s*(kg|KG|公斤|千克|斤|cm|厘米|岁|分钟|分|毫升|ml|ML|升|L|%|％)?/g;

function roundWeight(value: number) {
  return Number(value.toFixed(1));
}

function normalizeUnit(unit: string | null | undefined): WeightUnit {
  if (!unit) return null;
  const normalized = unit.toLowerCase();
  if (normalized === "kg" || unit === "公斤" || unit === "千克") return "kg";
  if (unit === "斤") return "斤";
  return null;
}

export function normalizeWeight(
  rawWeight: number | null,
  unit: WeightUnit,
  userHistoryWeight: number | null,
): NormalizedWeightResult {
  if (rawWeight === null || !Number.isFinite(rawWeight)) {
    return {
      weightKg: null,
      needsConfirmation: false,
      rawWeight: null,
      unit,
      reason: "No weight value was provided.",
    };
  }

  if (unit === "斤") {
    return {
      weightKg: roundWeight(rawWeight / 2),
      needsConfirmation: false,
      rawWeight,
      unit,
      reason: "Explicit jin unit.",
    };
  }

  if (unit === "kg" || unit === "公斤" || unit === "千克") {
    return {
      weightKg: roundWeight(rawWeight),
      needsConfirmation: false,
      rawWeight,
      unit,
      reason: "Explicit kg unit.",
    };
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
      return {
        weightKg: roundWeight(jinAsKg),
        needsConfirmation: false,
        rawWeight,
        unit: null,
        reason: "No unit, inferred jin from recent body weight.",
      };
    }

    return {
      weightKg: null,
      needsConfirmation: true,
      rawWeight,
      unit: null,
      reason: "No unit and the value is ambiguous.",
    };
  }

  return {
    weightKg: roundWeight(rawWeight),
    needsConfirmation: false,
    rawWeight,
    unit: null,
    reason: "No unit, accepted as kg within normal kg range.",
  };
}

function extractWeightMentions(input: string): WeightMention[] {
  return Array.from(input.matchAll(weightMentionPattern))
    .map((match) => {
      const unitText = match[2] ?? null;
      const unit = normalizeUnit(unitText);
      const index = match.index ?? 0;

      if (
        unitText &&
        unit === null &&
        /^(cm|厘米|岁|分钟|分|毫升|ml|ML|升|L|%|％)$/.test(unitText)
      ) {
        return null;
      }

      return {
        rawWeight: Number(match[1]),
        unit,
        index,
        negated: /(?:不是|并非|不为)$/.test(
          input.slice(Math.max(0, index - 6), index),
        ),
      };
    })
    .filter((mention): mention is WeightMention => mention !== null);
}

function chooseUnitlessMention(
  mentions: WeightMention[],
  modelWeightKg: number | null,
) {
  if (mentions.length === 0) return null;
  if (mentions.length === 1 || modelWeightKg === null) {
    return mentions[mentions.length - 1];
  }

  const exactModelMatch = mentions.find(
    (mention) => Math.abs(mention.rawWeight - modelWeightKg) < 0.2,
  );
  if (exactModelMatch) return exactModelMatch;

  const probableTruncation = mentions.find(
    (mention) =>
      mention.rawWeight > 140 &&
      Math.round(mention.rawWeight % 100) === Math.round(modelWeightKg),
  );
  if (probableTruncation) return probableTruncation;

  return mentions[mentions.length - 1];
}

export function normalizeWeightFromText({
  input,
  modelWeightKg,
  userHistoryWeight,
}: {
  input: string;
  modelWeightKg: number | null;
  userHistoryWeight: number | null;
}): NormalizedWeightResult {
  const allMentions = extractWeightMentions(input);
  const nonNegatedMentions = allMentions.filter((mention) => !mention.negated);
  const mentions =
    nonNegatedMentions.length > 0 ? nonNegatedMentions : allMentions;
  const explicitMention = [...mentions]
    .reverse()
    .find((mention) => mention.unit !== null);

  if (explicitMention) {
    return normalizeWeight(
      explicitMention.rawWeight,
      explicitMention.unit,
      userHistoryWeight,
    );
  }

  const mention = chooseUnitlessMention(mentions, modelWeightKg);
  if (mention) {
    return normalizeWeight(mention.rawWeight, null, userHistoryWeight);
  }

  return normalizeWeight(modelWeightKg, null, userHistoryWeight);
}
