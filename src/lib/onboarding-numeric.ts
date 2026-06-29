import { normalizeWeight } from "./weight";

export type OnboardingNumericField =
  | "age"
  | "height_cm"
  | "weight_kg"
  | "goal_weight_kg";

export type OnboardingNumericDraft = Record<
  OnboardingNumericField,
  number | null
>;

export type OnboardingNumericResolution =
  | {
      type: "none";
      confidence: 1;
      patch: Partial<OnboardingNumericDraft>;
      message: null;
    }
  | {
      type: "confirm";
      confidence: 0;
      patch: Partial<OnboardingNumericDraft>;
      message: string;
    }
  | {
      type: "patch";
      confidence: 1;
      patch: Partial<OnboardingNumericDraft>;
      message: null;
    };

const requiredNumericFields: OnboardingNumericField[] = [
  "age",
  "height_cm",
  "weight_kg",
  "goal_weight_kg",
];

const fieldLabels: Record<OnboardingNumericField, string> = {
  age: "年龄",
  height_cm: "身高",
  weight_kg: "当前体重",
  goal_weight_kg: "目标体重",
};

function createNone(): OnboardingNumericResolution {
  return {
    type: "none",
    confidence: 1,
    patch: {},
    message: null,
  };
}

function isBareNumber(input: string) {
  return /^\d+(?:\.\d+)?$/.test(input.trim());
}

function toNumber(input: string) {
  const value = Number(input.trim());
  return Number.isFinite(value) ? value : null;
}

export function resolveOnboardingNumericInput({
  input,
  currentDraft,
}: {
  input: string;
  currentDraft: OnboardingNumericDraft;
}): OnboardingNumericResolution {
  if (!isBareNumber(input)) {
    return createNone();
  }

  const value = toNumber(input);

  if (value === null) {
    return createNone();
  }

  const missingFields = requiredNumericFields.filter(
    (field) => currentDraft[field] === null,
  );

  if (missingFields.length === 0) {
    return createNone();
  }

  if (missingFields.length > 1) {
    return {
      type: "confirm",
      confidence: 0,
      patch: {},
      message: `${input.trim()} 是指${missingFields
        .map((field) => fieldLabels[field])
        .join("、")}中的哪一个？`,
    };
  }

  const field = missingFields[0];

  if (field === "weight_kg" || field === "goal_weight_kg") {
    const normalized = normalizeWeight(value, null, currentDraft.weight_kg);

    if (normalized.needConfirm) {
      return {
        type: "confirm",
        confidence: 0,
        patch: {},
        message: `${input.trim()} 是斤还是公斤？确认后我再帮你记录。`,
      };
    }
    
    if (normalized.weightKg === null) {
      return createNone();
    }
    
    return {
      type: "patch",
      confidence: 1,
      patch: { [field]: normalized.weightKg },
      message: null,
    };
  }

  return {
    type: "patch",
    confidence: 1,
    patch: { [field]: value },
    message: null,
  };
}
