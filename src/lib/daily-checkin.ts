export type WaterStatus = "unknown" | "low" | "normal" | "high";
export type DietStatus = "unknown" | "low" | "normal" | "good" | "over";
export type ProteinStatus = "unknown" | "low" | "normal" | "good";

export type DailyCheckin = {
  user_id: string;
  date: string;
  weight_recorded: boolean;
  weight_value: number | string | null;
  strength_done: boolean;
  strength_part: string | null;
  cardio_done: boolean;
  cardio_type: string | null;
  cardio_duration: number | string | null;
  water_status: WaterStatus;
  diet_status: DietStatus;
  protein_status: ProteinStatus;
  created_at?: string;
  updated_at?: string;
};

export type DailyCheckinPatch = Partial<
  Pick<
    DailyCheckin,
    | "weight_recorded"
    | "weight_value"
    | "strength_done"
    | "strength_part"
    | "cardio_done"
    | "cardio_type"
    | "cardio_duration"
    | "water_status"
    | "diet_status"
    | "protein_status"
  >
>;

export type CheckinExtraction = {
  has_checkin_info: boolean;
  weight: number | null;
  strength_done: boolean | null;
  strength_part: string | null;
  cardio_done: boolean | null;
  cardio_type: string | null;
  cardio_duration: number | null;
  water_status: WaterStatus | null;
  diet_status: DietStatus | null;
  protein_status: ProteinStatus | null;
};

export function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createEmptyDailyCheckin(
  userId: string,
  date = getLocalDateString(),
): DailyCheckin {
  return {
    user_id: userId,
    date,
    weight_recorded: false,
    weight_value: null,
    strength_done: false,
    strength_part: null,
    cardio_done: false,
    cardio_type: null,
    cardio_duration: null,
    water_status: "unknown",
    diet_status: "unknown",
    protein_status: "unknown",
  };
}

export function countCompletedCheckinItems(checkin: DailyCheckin) {
  return [
    checkin.weight_recorded,
    checkin.strength_done,
    checkin.cardio_done,
    checkin.water_status !== "unknown",
    checkin.diet_status !== "unknown" || checkin.protein_status !== "unknown",
  ].filter(Boolean).length;
}

export function createCheckinPatchFromExtraction(
  extraction: CheckinExtraction,
): DailyCheckinPatch {
  const patch: DailyCheckinPatch = {};

  if (extraction.weight !== null) {
    patch.weight_recorded = true;
    patch.weight_value = extraction.weight;
  }

  if (extraction.strength_done !== null) {
    patch.strength_done = extraction.strength_done;
    patch.strength_part = extraction.strength_done ? extraction.strength_part : null;
  } else if (extraction.strength_part) {
    patch.strength_done = true;
    patch.strength_part = extraction.strength_part;
  }

  if (extraction.cardio_done !== null) {
    patch.cardio_done = extraction.cardio_done;
    patch.cardio_type = extraction.cardio_done ? extraction.cardio_type : null;
    patch.cardio_duration = extraction.cardio_done ? extraction.cardio_duration : null;
  } else if (extraction.cardio_type || extraction.cardio_duration !== null) {
    patch.cardio_done = true;
    patch.cardio_type = extraction.cardio_type;
    patch.cardio_duration = extraction.cardio_duration;
  }

  if (extraction.water_status) patch.water_status = extraction.water_status;
  if (extraction.diet_status) patch.diet_status = extraction.diet_status;
  if (extraction.protein_status) patch.protein_status = extraction.protein_status;

  return patch;
}

export function hasCheckinPatch(patch: DailyCheckinPatch) {
  return Object.keys(patch).length > 0;
}

export function createCheckinReplyParts(patch: DailyCheckinPatch) {
  const parts: string[] = [];

  if (patch.weight_recorded && patch.weight_value !== null) {
    parts.push(`体重：${Number(patch.weight_value).toFixed(1)}kg`);
  }

  if (patch.strength_done) {
    parts.push(`力量训练：${patch.strength_part || "已完成"}`);
  }

  if (patch.cardio_done) {
    const detail = [
      patch.cardio_type || "已完成",
      patch.cardio_duration ? `${patch.cardio_duration}分钟` : null,
    ]
      .filter(Boolean)
      .join(" ");
    parts.push(`有氧：${detail}`);
  }

  if (patch.water_status && patch.water_status !== "unknown") {
    const label = { low: "不足", normal: "正常", high: "较多" }[patch.water_status];
    parts.push(`饮水：${label}`);
  }

  if (patch.protein_status && patch.protein_status !== "unknown") {
    const label = { low: "不足", normal: "一般", good: "达标" }[patch.protein_status];
    parts.push(`蛋白质：${label}`);
  }

  if (patch.diet_status && patch.diet_status !== "unknown") {
    const label = {
      low: "不足",
      normal: "一般",
      good: "达标",
      over: "放纵",
    }[patch.diet_status];
    parts.push(`饮食：${label}`);
  }

  return parts;
}

export function shouldIgnoreCheckinInput(input: string) {
  const otherPattern =
    /(朋友|同事|同学|家人|别人|其他人|我爸|我妈|爸爸|妈妈|父亲|母亲|老婆|老公|女朋友|男朋友|对象|张三|李四|孙策|他说|她说|他们说|她今天|他今天|他现在|她现在)/;
  const hypotheticalPattern = /(如果|假如|要是|会怎么样|怎么办)/;
  return otherPattern.test(input) || hypotheticalPattern.test(input);
}
