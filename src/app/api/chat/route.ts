import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  guardBodyUpdateDecision,
  type BodyUpdateSubject,
} from "@/lib/body-update-guard";
import {
  countCompletedCheckinItems,
  createCheckinPatchFromExtraction,
  createCheckinReplyParts,
  createEmptyDailyCheckin,
  getLocalDateString,
  hasCheckinPatch,
  shouldIgnoreCheckinInput,
  type CheckinExtraction,
  type DailyCheckin,
  type DailyCheckinPatch,
  type DietStatus,
  type ProteinStatus,
  type WaterStatus,
} from "@/lib/daily-checkin";
import {
  applyOnboardingWeightHints,
  normalizeWeightFromText,
} from "@/lib/weight";
import { resolveOnboardingNumericInput } from "@/lib/onboarding-numeric";

type MemoryType = "preference" | "habit" | "goal" | "persona" | "note";
type ChatRole = "user" | "assistant";

type BodyUpdate = {
  is_body_update: boolean;
  subject: BodyUpdateSubject;
  should_save: boolean;
  weight_kg: number | null;
  waist_cm: number | null;
  body_fat: number | null;
  arm_cm: number | null;
  thigh_cm: number | null;
  reason: string;
};

type OnboardingProfile = {
  nickname: string | null;
  sex: string | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  waist_cm: number | null;
  goal_weight_kg: number | null;
  training_frequency: string | null;
};

type OnboardingDraft = OnboardingProfile;

type BodyRecord = {
  weight_kg: number | string | null;
  waist_cm: number | string | null;
  body_fat: number | string | null;
  estimated_body_fat: number | string | null;
  bmi: number | string | null;
  arm_cm: number | string | null;
  thigh_cm: number | string | null;
  recorded_at: string;
};

type UserInfo = {
  nickname: string | null;
  sex: string | null;
  age: number | string | null;
  height_cm: number | string | null;
  goal_weight_kg: number | string | null;
  training_frequency: string | null;
};

type UserMemory = {
  memory_type: MemoryType;
  content: string;
  importance: number;
  updated_at: string;
};

type MemoryCandidate = {
  should_save: boolean;
  memory_type: MemoryType | null;
  content: string | null;
  importance: number | null;
};

const memoryTypes: MemoryType[] = [
  "preference",
  "habit",
  "goal",
  "persona",
  "note",
];

const requiredProfileFields: Array<keyof OnboardingProfile> = [
  "nickname",
  "sex",
  "age",
  "height_cm",
  "weight_kg",
  "goal_weight_kg",
];

const profileFieldLabels: Record<keyof OnboardingProfile, string> = {
  nickname: "昵称",
  sex: "性别",
  age: "年龄",
  height_cm: "身高",
  weight_kg: "当前体重",
  waist_cm: "腰围",
  goal_weight_kg: "目标体重",
  training_frequency: "训练频率",
};

const onboardingFieldLabels: Record<keyof OnboardingProfile, string> = {
  nickname: "昵称",
  sex: "性别",
  age: "年龄",
  height_cm: "身高",
  weight_kg: "当前体重",
  waist_cm: "腰围",
  goal_weight_kg: "目标体重",
  training_frequency: "训练频率",
};

function getModelEndpoint() {
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.deepseek.com";
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

function getApiKey() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("缺少 OPENAI_API_KEY，请先在 .env.local 中配置 DeepSeek API Key。");
  }

  return apiKey;
}

function createSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("缺少 Supabase 服务端环境变量，请检查 .env.local。");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function toNumberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeSex(sex: string | null) {
  if (!sex) {
    return null;
  }

  const normalized = sex.trim().toLowerCase();

  if (["男", "男性", "male", "m"].includes(normalized)) {
    return "male";
  }

  if (["女", "女性", "female", "f"].includes(normalized)) {
    return "female";
  }

  return sex.trim();
}

function calculateBodyMetrics({
  weightKg,
  userInfo,
}: {
  weightKg: number | null;
  userInfo: Pick<UserInfo, "sex" | "age" | "height_cm">;
}) {
  const heightCm = toNumberOrNull(userInfo.height_cm);
  const age = toNumberOrNull(userInfo.age);
  const sex = normalizeSex(userInfo.sex);

  if (!weightKg || !heightCm) {
    return {
      bmi: null,
      estimated_body_fat: null,
    };
  }

  const bmi = Number((weightKg / (heightCm / 100) ** 2).toFixed(1));
  let estimatedBodyFat: number | null = null;

  if (age !== null && sex) {
    const estimate =
      sex === "male"
        ? 1.2 * bmi + 0.23 * age - 16.2
        : 1.2 * bmi + 0.23 * age - 5.4;
    estimatedBodyFat = Number(estimate.toFixed(1));
  }

  return {
    bmi,
    estimated_body_fat: estimatedBodyFat,
  };
}

function normalizeBodyUpdate(value: Record<string, unknown>): BodyUpdate {
  const subject =
    typeof value.subject === "string" &&
    ["self", "other", "goal", "history", "uncertain"].includes(value.subject)
      ? (value.subject as BodyUpdateSubject)
      : "uncertain";

  return {
    is_body_update: value.is_body_update === true,
    subject,
    should_save: value.should_save === true,
    weight_kg: toNumberOrNull(value.weight_kg),
    waist_cm: toNumberOrNull(value.waist_cm),
    body_fat: toNumberOrNull(value.body_fat),
    arm_cm: toNumberOrNull(value.arm_cm),
    thigh_cm: toNumberOrNull(value.thigh_cm),
    reason:
      typeof value.reason === "string" && value.reason.trim()
        ? value.reason.trim()
        : "未提供判断原因",
  };
}

function normalizeProfile(value: Record<string, unknown>): OnboardingProfile {
  return {
    nickname:
      typeof value.nickname === "string" && value.nickname.trim()
        ? value.nickname.trim()
        : null,
    sex:
      typeof value.sex === "string" && value.sex.trim()
        ? normalizeSex(value.sex)
        : null,
    age: toNumberOrNull(value.age),
    height_cm: toNumberOrNull(value.height_cm),
    weight_kg: toNumberOrNull(value.weight_kg),
    waist_cm: toNumberOrNull(value.waist_cm),
    goal_weight_kg: toNumberOrNull(value.goal_weight_kg),
    training_frequency:
      typeof value.training_frequency === "string" &&
      value.training_frequency.trim()
        ? value.training_frequency.trim()
        : null,
  };
}

function createEmptyOnboardingDraft(): OnboardingDraft {
  return {
    nickname: null,
    sex: null,
    age: null,
    height_cm: null,
    weight_kg: null,
    waist_cm: null,
    goal_weight_kg: null,
    training_frequency: null,
  };
}

function normalizeDraft(value: unknown): OnboardingDraft {
  if (!value || typeof value !== "object") {
    return createEmptyOnboardingDraft();
  }

  return normalizeProfile(value as Record<string, unknown>);
}

function mergeOnboardingDraft(
  currentDraft: OnboardingDraft,
  extractedProfile: OnboardingProfile,
) {
  const nextDraft = { ...currentDraft };

  (Object.keys(nextDraft) as Array<keyof OnboardingDraft>).forEach((field) => {
    const value = extractedProfile[field];

    if (value !== null && value !== "") {
      (
        nextDraft as Record<keyof OnboardingDraft, string | number | null>
      )[field] = value;
    }
  });

  return nextDraft;
}

function normalizeMemoryCandidate(
  value: Record<string, unknown>,
): MemoryCandidate {
  const memoryType =
    typeof value.memory_type === "string" &&
    memoryTypes.includes(value.memory_type as MemoryType)
      ? (value.memory_type as MemoryType)
      : null;
  const importance = toNumberOrNull(value.importance);

  return {
    should_save: value.should_save === true,
    memory_type: memoryType,
    content:
      typeof value.content === "string" && value.content.trim()
        ? value.content.trim()
        : null,
    importance:
      importance !== null
        ? Math.min(5, Math.max(1, Math.round(importance)))
        : null,
  };
}

function parseJsonObject(content: string) {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  return JSON.parse(withoutFence) as Record<string, unknown>;
}

async function callDeepSeek({
  messages,
  temperature = 0.3,
  json = false,
}: {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  json?: boolean;
}) {
  let response: Response;

  try {
    response = await fetch(getModelEndpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages,
        temperature,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知网络错误";
    throw new Error(`DeepSeek API 请求失败：${reason}`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `DeepSeek API 返回错误（${response.status}）：${errorText || response.statusText}`,
    );
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("DeepSeek API 响应中缺少回复内容。");
  }

  return content;
}

async function saveChatMessage({
  supabase,
  userId,
  role,
  content,
}: {
  supabase: ReturnType<typeof createSupabaseAdmin>;
  userId: string;
  role: ChatRole;
  content: string;
}) {
  const { error } = await supabase.from("chat_messages").insert({
    user_id: userId,
    role,
    content,
  });

  if (error) {
    throw new Error(`写入 chat_messages 失败：${error.message}`);
  }
}

async function extractBodyUpdate(input: string): Promise<BodyUpdate> {
  const content = await callDeepSeek({
    json: true,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "你是身体数据更新识别器，只输出 JSON。字段必须包含 is_body_update, subject, should_save, weight_kg, waist_cm, body_fat, arm_cm, thigh_cm, reason。subject 只能是 self/other/goal/history/uncertain。只有用户表达的是当前登录用户本人的当前身体数据时，subject=self 且 should_save=true。没有明确主语但符合中文日常记录表达，例如“今天体重100kg”“早上空腹100.5kg”“腰围92cm”，默认 subject=self。朋友、同事、家人、我爸、我妈、女朋友、男朋友、张三、李四、孙策等第三方数据 subject=other 且 should_save=false。目标、愿望、计划，例如“目标体重85kg”“我希望减到85kg”，subject=goal 且 should_save=false。历史数据，例如“我以前100kg”“去年我120kg”，subject=history 且 should_save=false。假设问题，例如“如果我到90kg会怎么样”，subject=goal 或 uncertain 且 should_save=false。体重单位统一 kg，腰围/臂围/腿围统一 cm，体脂统一百分比数字。没提到的数字字段填 null。",
      },
      {
        role: "user",
        content: input,
      },
    ],
  });

  try {
    return normalizeBodyUpdate(parseJsonObject(content));
  } catch {
    throw new Error("DeepSeek API 返回的身体数据识别结果不是有效 JSON。");
  }
}

function normalizeCheckinExtraction(
  value: Record<string, unknown>,
): CheckinExtraction {
  const waterStatus =
    typeof value.water_status === "string" &&
    ["unknown", "low", "normal", "high"].includes(value.water_status)
      ? (value.water_status as WaterStatus)
      : null;
  const dietStatus =
    typeof value.diet_status === "string" &&
    ["unknown", "low", "normal", "good", "over"].includes(value.diet_status)
      ? (value.diet_status as DietStatus)
      : null;
  const proteinStatus =
    typeof value.protein_status === "string" &&
    ["unknown", "low", "normal", "good"].includes(value.protein_status)
      ? (value.protein_status as ProteinStatus)
      : null;

  return {
    has_checkin_info: value.has_checkin_info === true,
    weight: toNumberOrNull(value.weight),
    strength_done:
      typeof value.strength_done === "boolean" ? value.strength_done : null,
    strength_part:
      typeof value.strength_part === "string" && value.strength_part.trim()
        ? value.strength_part.trim()
        : null,
    cardio_done:
      typeof value.cardio_done === "boolean" ? value.cardio_done : null,
    cardio_type:
      typeof value.cardio_type === "string" && value.cardio_type.trim()
        ? value.cardio_type.trim()
        : null,
    cardio_duration: toNumberOrNull(value.cardio_duration),
    water_status: waterStatus,
    diet_status: dietStatus,
    protein_status: proteinStatus,
  };
}

async function extractDailyCheckin(input: string): Promise<CheckinExtraction> {
  const content = await callDeepSeek({
    json: true,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "你是今日减脂打卡信息提取器，只输出 JSON。字段必须包含 has_checkin_info, weight, strength_done, strength_part, cardio_done, cardio_type, cardio_duration, water_status, diet_status, protein_status。只提取当前登录用户本人今天已经发生或明确打卡的行为。朋友、家人、别人、张三、李四、孙策等第三方内容不要提取。假设、计划、建议、问题不要提取。力量训练部位可输出腿部、胸部、背部、肩部、手臂、胸+三头、背+二头等。有氧类型可输出跑步机爬坡、动感单车、户外跑、快走、自行车等，时长单位统一分钟。饮水 water_status 只能是 unknown/low/normal/high。饮食 diet_status 只能是 unknown/low/normal/good/over。蛋白质 protein_status 只能是 unknown/low/normal/good。没有提到的字段填 null；如果完全没有打卡信息，has_checkin_info=false。",
      },
      {
        role: "user",
        content: input,
      },
    ],
  });

  try {
    return normalizeCheckinExtraction(parseJsonObject(content));
  } catch {
    throw new Error("DeepSeek API 返回的今日打卡识别结果不是有效 JSON。");
  }
}

async function getOrCreateDailyCheckin(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  userId: string,
  date = getLocalDateString(),
) {
  const { data, error } = await supabase
    .from("daily_checkin")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle<DailyCheckin>();

  if (error) {
    throw new Error(`查询 daily_checkin 失败：${error.message}`);
  }

  if (data) {
    return data;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("daily_checkin")
    .insert(createEmptyDailyCheckin(userId, date))
    .select("*")
    .single<DailyCheckin>();

  if (insertError) {
    throw new Error(`创建 daily_checkin 失败：${insertError.message}`);
  }

  return inserted;
}

async function updateDailyCheckin(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  userId: string,
  patch: DailyCheckinPatch,
) {
  const date = getLocalDateString();

  await getOrCreateDailyCheckin(supabase, userId, date);

  const { data, error } = await supabase
    .from("daily_checkin")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("date", date)
    .select("*")
    .single<DailyCheckin>();

  if (error) {
    throw new Error(`更新 daily_checkin 失败：${error.message}`);
  }

  return data;
}

async function createCheckinPatchFromMessage({
  message,
  bodyUpdate,
}: {
  message: string;
  bodyUpdate: BodyUpdate;
}) {
  if (shouldIgnoreCheckinInput(message)) {
    return {};
  }

  const extraction = await extractDailyCheckin(message);
  const patch = extraction.has_checkin_info
    ? createCheckinPatchFromExtraction(extraction)
    : {};

  if (
    bodyUpdate.is_body_update &&
    bodyUpdate.subject === "self" &&
    bodyUpdate.should_save &&
    bodyUpdate.weight_kg !== null
  ) {
    patch.weight_recorded = true;
    patch.weight_value = bodyUpdate.weight_kg;
  }

  return patch;
}

function createCheckinReply({
  patch,
  checkin,
}: {
  patch: DailyCheckinPatch;
  checkin: DailyCheckin;
}) {
  const parts = createCheckinReplyParts(patch);
  const completedCount = countCompletedCheckinItems(checkin);
  const hydrationTip =
    patch.water_status === "low" ? "今天记得再补点水。" : "";

  if (parts.length === 0) {
    return "";
  }

  return `已记录。${parts.join("；")}。今天已完成 ${completedCount} 项，继续保持。${hydrationTip}`;
}

function createCheckinReplyV2({
  patch,
  checkin,
}: {
  patch: DailyCheckinPatch;
  checkin: DailyCheckin;
}) {
  const parts = createCheckinReplyParts(patch);
  const completedCount = countCompletedCheckinItems(checkin);
  const hydrationTip = patch.water_status === "low" ? "\n今天记得再补点水。" : "";

  if (parts.length === 0) {
    return "";
  }

  return `✅ 已记录。\n${parts.join("\n")}\n\nAI分析：\n今天已经完成${completedCount}项打卡。继续保持。${hydrationTip}`;
}

async function extractOnboardingProfile(input: string) {
  const content = await callDeepSeek({
    json: true,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "你是减脂建档信息提取器。你只负责从本轮用户输入中提取字段，不判断是否完整，不决定是否建档。只输出 JSON，字段固定为 nickname, sex, age, height_cm, weight_kg, waist_cm, goal_weight_kg, training_frequency。没有提到的字段填 null。sex 统一输出 male 或 female。身高默认单位 cm。腰围默认单位 cm。体重统一输出 kg：如果用户输入“120斤”保存为 60；如果输入“100kg”保存为 100；如果用户只输入“120”且语境是体重或当前体重，默认按斤处理并输出 60；目标体重同样按用户表达单位换算。不要输出解释。",
      },
      {
        role: "user",
        content: input,
      },
    ],
  });

  try {
    return normalizeProfile(parseJsonObject(content));
  } catch {
    throw new Error("DeepSeek API 返回的建档结果不是有效 JSON。");
  }
}

function getMissingProfileFields(profile: OnboardingProfile) {
  return requiredProfileFields.filter((field) => {
    const value = profile[field];
    return value === null || value === "";
  });
}

function validateOnboardingProfile(profile: OnboardingProfile) {
  const missingFields = getMissingProfileFields(profile);

  if (missingFields.length > 0) {
    return `还差这些建档信息：${missingFields
      .map((field) => profileFieldLabels[field])
      .join("、")}。请一次性补充完整，我再帮你写入建档。`;
  }

  if (profile.weight_kg !== null && profile.weight_kg > 140) {
    return "你输入的体重可能偏高，请确认数据是否正确后再提交，我先不写入建档。";
  }

  if (profile.height_cm !== null && profile.height_cm > 210) {
    return "你输入的身高可能偏高，请确认数据是否正确后再提交，我先不写入建档。";
  }

  return null;
}

function validateMergedOnboardingProfile(profile: OnboardingProfile) {
  const missingFields = getMissingProfileFields(profile);

  if (missingFields.length > 0) {
    return `还差这些建档信息：${missingFields
      .map((field) => onboardingFieldLabels[field])
      .join("、")}。你可以一次性告诉我，我再帮你完成建档。`;
  }

  if (
    profile.weight_kg !== null &&
    (profile.weight_kg < 30 || profile.weight_kg > 200)
  ) {
    return "你输入的体重可能异常，请确认后再提交，我先不写入建档。";
  }

  if (
    profile.height_cm !== null &&
    (profile.height_cm < 120 || profile.height_cm > 230)
  ) {
    return "你输入的身高可能异常，请确认后再提交，我先不写入建档。";
  }

  if (
    profile.waist_cm !== null &&
    (profile.waist_cm < 40 || profile.waist_cm > 180)
  ) {
    return "你输入的腰围可能异常，请确认后再提交，我先不写入建档。";
  }

  return null;
}

async function handleOnboardingInChat({
  supabase,
  userId,
  message,
  onboardingDraft,
}: {
  supabase: ReturnType<typeof createSupabaseAdmin>;
  userId: string;
  message: string;
  onboardingDraft: OnboardingDraft;
}) {
  const numericResolution = resolveOnboardingNumericInput({
    input: message,
    currentDraft: onboardingDraft,
  });

  if (numericResolution.type === "confirm") {
    await saveChatMessage({
      supabase,
      userId,
      role: "assistant",
      content: numericResolution.message,
    });

    return NextResponse.json({
      ok: true,
      type: "onboarding_confirm",
      message: numericResolution.message,
      profile: onboardingDraft,
      onboardingDraft,
    });
  }

  const extractedProfile =
    numericResolution.type === "patch"
      ? {
          ...createEmptyOnboardingDraft(),
          ...numericResolution.patch,
        }
      : await extractOnboardingProfile(message);
  const profile = applyOnboardingWeightHints({
    input: message,
    currentDraft: onboardingDraft,
    extractedProfile: mergeOnboardingDraft(
      createEmptyOnboardingDraft(),
      extractedProfile,
    ),
  });
  const validationMessage = validateMergedOnboardingProfile(profile);

  if (validationMessage) {
    await saveChatMessage({
      supabase,
      userId,
      role: "assistant",
      content: validationMessage,
    });

    return NextResponse.json({
      ok: true,
      type: "onboarding",
      message: validationMessage,
      profile,
      onboardingDraft: profile,
    });
  }

  const { data: existingUser } = await supabase
    .from("user_info")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existingUser) {
    const reply = "检测到您已经完成建档，无需重复建档。";
    await saveChatMessage({ supabase, userId, role: "assistant", content: reply });

    return NextResponse.json({
      ok: true,
      type: "onboarding_exists",
      message: reply,
    });
  }

  const userInfoForMetrics: Pick<UserInfo, "sex" | "age" | "height_cm"> = {
    sex: profile.sex,
    age: profile.age,
    height_cm: profile.height_cm,
  };
  const metrics = calculateBodyMetrics({
    weightKg: profile.weight_kg,
    userInfo: userInfoForMetrics,
  });

  const { error: infoError } = await supabase.from("user_info").insert({
    user_id: userId,
    nickname: profile.nickname,
    sex: profile.sex,
    age: profile.age,
    height_cm: profile.height_cm,
    goal_weight_kg: profile.goal_weight_kg,
    training_frequency: profile.training_frequency,
  });

  if (infoError) {
    throw new Error(`写入 user_info 失败：${infoError.message}`);
  }

  const { error: recordError } = await supabase.from("user_body_record").insert({
    user_id: userId,
    weight_kg: profile.weight_kg,
    waist_cm: profile.waist_cm,
    body_fat: null,
    bmi: metrics.bmi,
    estimated_body_fat: metrics.estimated_body_fat,
    arm_cm: null,
    thigh_cm: null,
    recorded_at: new Date().toISOString(),
  });

  if (recordError) {
    throw new Error(`写入 user_body_record 失败：${recordError.message}`);
  }

  const reply =
    "我已经记住你的基础信息了，之后你可以直接告诉我体重、饮食、训练情况，我会持续帮你分析。";

  await saveChatMessage({
    supabase,
    userId,
    role: "assistant",
    content: reply,
  });

  return NextResponse.json({
    ok: true,
    type: "onboarding_completed",
    message: reply,
    profile,
    onboardingDraft: null,
  });
}

async function selectMemoryCandidate({
  userMessage,
  assistantReply,
  bodyUpdate,
}: {
  userMessage: string;
  assistantReply: string;
  bodyUpdate: BodyUpdate;
}) {
  const content = await callDeepSeek({
    json: true,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "你是长期记忆筛选器。只判断本轮用户输入是否包含长期稳定画像，输出 JSON，不要解释。可保存的信息包括：用户偏好、饮食习惯、训练习惯、长期目标、称呼偏好、不喜欢的表达方式。不要保存临时情绪、单次事件、普通闲聊、一次性身体数据。尤其不要把体重、腰围、体脂、臂围、腿围等每日身体数据写入长期记忆。字段必须是 should_save, memory_type, content, importance。memory_type 只能是 preference/habit/goal/persona/note。importance 是 1-5。",
      },
      {
        role: "user",
        content: JSON.stringify({
          user_message: userMessage,
          assistant_reply: assistantReply,
          detected_body_update: bodyUpdate,
        }),
      },
    ],
  });

  try {
    return normalizeMemoryCandidate(parseJsonObject(content));
  } catch {
    throw new Error("DeepSeek API 返回的长期记忆筛选结果不是有效 JSON。");
  }
}

function validateBodyUpdate(update: BodyUpdate) {
  if (
    update.weight_kg !== null &&
    (update.weight_kg > 200 || update.weight_kg < 30)
  ) {
    return "你输入的体重可能异常，请确认后再提交。";
  }

  if (
    update.waist_cm !== null &&
    (update.waist_cm > 180 || update.waist_cm < 40)
  ) {
    return "你输入的腰围可能异常，请确认后再提交。";
  }

  if (
    update.body_fat !== null &&
    (update.body_fat > 70 || update.body_fat < 3)
  ) {
    return "你输入的体脂率可能异常，请确认后再提交。";
  }

  return null;
}

function hasCurrentWeightIntent(message: string) {
  return (
    /(体重|称重|称了|称一下|空腹|瘦到|胖到|重了|轻了|现在是|现在).{0,8}\d/.test(
      message,
    ) || /\d+(?:\.\d+)?\s*(kg|KG|公斤|千克|斤)/.test(message)
  );
}

function normalizeBodyUpdateWeight({
  message,
  bodyUpdate,
  latestRecord,
}: {
  message: string;
  bodyUpdate: BodyUpdate;
  latestRecord: BodyRecord | null;
}) {
  if (
    !bodyUpdate.is_body_update ||
    bodyUpdate.subject !== "self" ||
    bodyUpdate.should_save !== true
  ) {
    return {
      bodyUpdate,
      confirmationMessage: null as string | null,
    };
  }

  if (bodyUpdate.weight_kg === null && !hasCurrentWeightIntent(message)) {
    return {
      bodyUpdate,
      confirmationMessage: null as string | null,
    };
  }

  const normalized = normalizeWeightFromText({
    input: message,
    modelWeightKg: bodyUpdate.weight_kg,
    userHistoryWeight: latestRecord
      ? toNumberOrNull(latestRecord.weight_kg)
      : null,
  });

  if (normalized.needsConfirmation) {
    return {
      bodyUpdate,
      confirmationMessage: `你说的${normalized.rawWeight}是斤还是公斤？确认后我再帮你记录。`,
    };
  }

  if (normalized.weightKg === null) {
    return {
      bodyUpdate,
      confirmationMessage: null as string | null,
    };
  }

  return {
    bodyUpdate: {
      ...bodyUpdate,
      weight_kg: normalized.weightKg,
    },
    confirmationMessage: null as string | null,
  };
}

function formatChange(current: number, previous: number, unit: string) {
  const diff = Number((current - previous).toFixed(1));

  if (diff === 0) {
    return `和上次持平，都是 ${current}${unit}`;
  }

  const direction = diff > 0 ? "增加" : "下降";
  return `从 ${previous}${unit} 到 ${current}${unit}，${direction} ${Math.abs(diff)}${unit}`;
}

function createBodyUpdateReply(
  update: BodyUpdate,
  previousRecord: BodyRecord | null,
  metrics: { bmi: number | null; estimated_body_fat: number | null },
) {
  if (!previousRecord) {
    const estimateNote =
      update.body_fat === null && metrics.estimated_body_fat !== null
        ? " 这个体脂率是根据 BMI 估算的，只能作为参考，不等同于真实体脂测量。"
        : "";
    return `已记录，这是你的第一条身体更新记录。我们先把基线稳定记下来，后面再看趋势。${estimateNote}`;
  }

  const lines = ["已记录。"];
  const previousWeight = toNumberOrNull(previousRecord.weight_kg);
  const previousWaist = toNumberOrNull(previousRecord.waist_cm);

  if (update.weight_kg !== null && previousWeight !== null) {
    lines.push(
      `体重${formatChange(update.weight_kg, previousWeight, "kg")}。短期体重波动可能受水分、盐分、训练和碳水影响，先看连续几天的趋势更准。`,
    );
  }

  if (update.waist_cm !== null && previousWaist !== null) {
    lines.push(
      `腰围${formatChange(update.waist_cm, previousWaist, "cm")}。腰围变化通常比单日体重更能反映阶段趋势，继续保持记录。`,
    );
  }

  if (metrics.bmi !== null) {
    lines.push(`本次 BMI 约为 ${metrics.bmi}。`);
  }

  if (update.body_fat === null && metrics.estimated_body_fat !== null) {
    lines.push(
      "这个体脂率是根据 BMI 估算的，只能作为参考，不等同于真实体脂测量。",
    );
  }

  if (lines.length === 1) {
    lines.push("这次数据已保存。继续按同一时间、同一状态记录，会更容易看出真实变化。");
  }

  return lines.join("");
}

function formatKg(value: number) {
  return `${Number(value.toFixed(1))}kg`;
}

function formatSignedKg(current: number, previous: number) {
  const diff = Number((current - previous).toFixed(1));

  if (diff === 0) {
    return "持平";
  }

  return `${diff > 0 ? "上升" : "下降"}${formatKg(Math.abs(diff))}`;
}

function getDayDiff(currentDate: Date, previousDate: Date) {
  const currentStart = new Date(currentDate);
  const previousStart = new Date(previousDate);

  currentStart.setHours(0, 0, 0, 0);
  previousStart.setHours(0, 0, 0, 0);

  return Math.max(
    0,
    Math.floor(
      (currentStart.getTime() - previousStart.getTime()) / (24 * 60 * 60 * 1000),
    ),
  );
}

function getTrendLabel(records: BodyRecord[], currentWeight: number) {
  const points = [
    ...records
      .map((record) => toNumberOrNull(record.weight_kg))
      .filter((value): value is number => value !== null),
    currentWeight,
  ];

  if (points.length < 2) {
    return "记录还不够，先继续观察";
  }

  const diff = Number((points[points.length - 1] - points[0]).toFixed(1));

  if (diff <= -0.3) {
    return "下降";
  }

  if (diff >= 0.3) {
    return "上升";
  }

  return "平稳";
}

function createMetricNote(
  update: BodyUpdate,
  metrics: { bmi: number | null; estimated_body_fat: number | null },
) {
  const notes: string[] = [];

  if (metrics.bmi !== null) {
    notes.push(`BMI约${metrics.bmi}`);
  }

  if (update.body_fat === null && metrics.estimated_body_fat !== null) {
    notes.push("体脂率为BMI估算，仅供参考");
  }

  return notes.length > 0 ? ` ${notes.join("，")}。` : "";
}

function createBodyUpdateReplyV2({
  update,
  previousRecord,
  metrics,
  todayWeightRecords,
  recentWeightRecords,
}: {
  update: BodyUpdate;
  previousRecord: BodyRecord | null;
  metrics: { bmi: number | null; estimated_body_fat: number | null };
  todayWeightRecords: BodyRecord[];
  recentWeightRecords: BodyRecord[];
}) {
  const metricNote = createMetricNote(update, metrics);
  const currentWeight = update.weight_kg;

  if (currentWeight !== null) {
    const previousWeight = previousRecord
      ? toNumberOrNull(previousRecord.weight_kg)
      : null;

    if (!previousRecord || previousWeight === null) {
      return `已记录。这是你的第一条体重记录，后续连续记录后，我会帮你分析趋势变化。${metricNote}`;
    }

    const latestTodayRecord = todayWeightRecords[0] ?? null;
    const latestTodayWeight = latestTodayRecord
      ? toNumberOrNull(latestTodayRecord.weight_kg)
      : null;

    if (todayWeightRecords.length > 0 && latestTodayWeight !== null) {
      return `已记录。今天已有体重记录，本次为今日第${todayWeightRecords.length + 1}次记录。当前体重${formatKg(currentWeight)}，相比今天上一次记录${formatSignedKg(currentWeight, latestTodayWeight)}。同一天内体重变化更多受饮水、进食、排便和训练出汗影响，不建议直接理解为真实减脂。建议优先以每天早晨空腹体重作为主记录。${metricNote}`;
    }

    const dayDiff = getDayDiff(new Date(), new Date(previousRecord.recorded_at));

    if (dayDiff > 7) {
      return `已记录。距离上次记录已有${dayDiff}天，当前体重较上次${formatSignedKg(currentWeight, previousWeight)}。这更适合看作阶段性变化，但由于中间缺少连续记录，建议接下来连续记录3-7天，以便判断真实趋势。${metricNote}`;
    }

    if (dayDiff >= 1 && dayDiff <= 3) {
      const trendLabel = getTrendLabel(recentWeightRecords, currentWeight);

      return `已记录。当前体重${formatKg(currentWeight)}，较上次记录${formatSignedKg(currentWeight, previousWeight)}。单次变化可能包含水分变化，建议结合最近7天趋势判断。目前整体趋势为${trendLabel}。${metricNote}`;
    }

    return `已记录。当前体重${formatKg(currentWeight)}，较上次记录${formatSignedKg(currentWeight, previousWeight)}。先把记录连续性保持住，趋势会比单次数字更有参考价值。${metricNote}`;
  }

  if (!previousRecord) {
    return `已记录。这是你的第一条身体记录，后续连续记录后，我会帮你分析趋势变化。${metricNote}`;
  }

  const previousWaist = toNumberOrNull(previousRecord.waist_cm);

  if (update.waist_cm !== null && previousWaist !== null) {
    return `已记录。腰围从${previousWaist}cm到${update.waist_cm}cm，继续保持同一测量位置和测量时间，趋势会更有参考价值。${metricNote}`;
  }

  return `已记录。这次数据已保存，继续按同一时间、同一状态记录，会更容易看出真实变化。${metricNote}`;
}

function createMetricLine({
  metrics,
  isRepeatedToday,
}: {
  metrics: { bmi: number | null; estimated_body_fat: number | null };
  isRepeatedToday: boolean;
}) {
  if (metrics.bmi === null) {
    return "";
  }

  if (isRepeatedToday) {
    return `BMI：${metrics.bmi}（估算）`;
  }

  if (metrics.estimated_body_fat !== null) {
    return `BMI约${metrics.bmi}，体脂率根据BMI估算，仅供参考。`;
  }

  return `BMI约${metrics.bmi}。`;
}

function createBodyUpdateReplyV3({
  update,
  previousRecord,
  metrics,
  todayWeightRecords,
  recentWeightRecords,
  checkinParts,
  completedCount,
}: {
  update: BodyUpdate;
  previousRecord: BodyRecord | null;
  metrics: { bmi: number | null; estimated_body_fat: number | null };
  todayWeightRecords: BodyRecord[];
  recentWeightRecords: BodyRecord[];
  checkinParts: string[];
  completedCount: number | null;
}) {
  const resultLines = ["✅ 已记录。"];

  if (update.weight_kg !== null) {
    resultLines.push(`体重：${formatKg(update.weight_kg)}`);
  }

  if (update.waist_cm !== null) {
    resultLines.push(`腰围：${update.waist_cm}cm`);
  }

  checkinParts.forEach((part) => resultLines.push(part));

  const analysisLines: string[] = [];
  const currentWeight = update.weight_kg;
  const previousWeight = previousRecord
    ? toNumberOrNull(previousRecord.weight_kg)
    : null;
  const isRepeatedToday = todayWeightRecords.length > 0;
  const metricLine = createMetricLine({ metrics, isRepeatedToday });

  if (currentWeight !== null) {
    const latestTodayRecord = todayWeightRecords[0] ?? null;
    const latestTodayWeight = latestTodayRecord
      ? toNumberOrNull(latestTodayRecord.weight_kg)
      : null;

    if (!previousRecord || previousWeight === null) {
      analysisLines.push("这是你的第一条体重记录，连续记录后我会帮你看趋势。");
    } else if (isRepeatedToday && latestTodayWeight !== null) {
      analysisLines.push(
        `今天第${todayWeightRecords.length + 1}次体重记录，相比今天上一条${formatSignedKg(
          currentWeight,
          latestTodayWeight,
        )}。`,
      );
      analysisLines.push(
        "同一天内体重变化更多受饮水、进食、训练和排汗影响，建议优先参考每天早晨空腹体重。",
      );
    } else {
      const dayDiff = getDayDiff(new Date(), new Date(previousRecord.recorded_at));

      if (dayDiff > 7) {
        analysisLines.push(
          `距离上次记录已有${dayDiff}天，较上次${formatSignedKg(
            currentWeight,
            previousWeight,
          )}。中间缺少连续记录，接下来连续记录3-7天会更好判断趋势。`,
        );
      } else {
        const trendLabel = getTrendLabel(recentWeightRecords, currentWeight);
        analysisLines.push(
          `较上次记录${formatSignedKg(
            currentWeight,
            previousWeight,
          )}，最近7天整体趋势：${trendLabel}。`,
        );
      }
    }
  } else if (update.waist_cm !== null) {
    const previousWaist = previousRecord
      ? toNumberOrNull(previousRecord.waist_cm)
      : null;

    if (previousWaist !== null) {
      analysisLines.push(
        `腰围从${previousWaist}cm到${update.waist_cm}cm，建议保持同一测量位置和时间。`,
      );
    } else {
      analysisLines.push("这次腰围已保存，连续记录后趋势会更清楚。");
    }
  } else {
    analysisLines.push("这次身体数据已保存，继续保持同一状态记录会更有参考价值。");
  }

  if (completedCount !== null) {
    analysisLines.push(`今天已经完成${completedCount}项打卡。`);
  }

  if (metricLine) {
    analysisLines.push(metricLine);
  }

  return `${resultLines.join("\n")}\n\nAI分析：\n${analysisLines.join("\n")}`;
}

function formatMemories(memories: UserMemory[]) {
  if (memories.length === 0) {
    return "暂无长期记忆。";
  }

  return memories
    .map(
      (memory) =>
        `- [${memory.memory_type}, 重要度${memory.importance}] ${memory.content}`,
    )
    .join("\n");
}

function normalizeForDedup(value: string) {
  return value
    .toLowerCase()
    .replace(/[，。！？、,.!?;；\s]/g, "")
    .trim();
}

function isSimilarMemory(nextContent: string, existingContent: string) {
  const next = normalizeForDedup(nextContent);
  const existing = normalizeForDedup(existingContent);

  if (!next || !existing) {
    return false;
  }

  return next.includes(existing) || existing.includes(next);
}

async function fetchUserMemories(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  userId: string,
) {
  const { data, error } = await supabase
    .from("user_memory")
    .select("memory_type, content, importance, updated_at")
    .eq("user_id", userId)
    .order("importance", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(8);

  if (error) {
    throw new Error(`查询 user_memory 失败：${error.message}`);
  }

  return (data ?? []) as UserMemory[];
}

async function saveMemoryIfNeeded({
  supabase,
  userId,
  userMessage,
  assistantReply,
  bodyUpdate,
}: {
  supabase: ReturnType<typeof createSupabaseAdmin>;
  userId: string;
  userMessage: string;
  assistantReply: string;
  bodyUpdate: BodyUpdate;
}) {
  try {
    const candidate = await selectMemoryCandidate({
      userMessage,
      assistantReply,
      bodyUpdate,
    });

    if (
      !candidate.should_save ||
      !candidate.memory_type ||
      !candidate.content ||
      !candidate.importance
    ) {
      return;
    }

    const { data: existingMemories, error: existingError } = await supabase
      .from("user_memory")
      .select("content")
      .eq("user_id", userId)
      .limit(50);

    if (existingError) {
      throw new Error(existingError.message);
    }

    const alreadyExists = (existingMemories ?? []).some((memory) =>
      isSimilarMemory(candidate.content as string, memory.content),
    );

    if (alreadyExists) {
      return;
    }

    const { error: insertError } = await supabase.from("user_memory").insert({
      user_id: userId,
      memory_type: candidate.memory_type,
      content: candidate.content,
      importance: candidate.importance,
    });

    if (insertError) {
      throw new Error(insertError.message);
    }
  } catch (error) {
    console.error("Failed to save user memory", error);
  }
}

async function createCompanionReply({
  message,
  userInfo,
  latestRecord,
  memories,
}: {
  message: string;
  userInfo: UserInfo;
  latestRecord: BodyRecord | null;
  memories: UserMemory[];
}) {
  return callDeepSeek({
    messages: [
      {
        role: "system",
        content: `你是一名专业、温暖、自然的 AI 减脂陪伴教练。回复要简洁、有支持感，不要编造用户没有提供的数据，不要生成长期周报或月报，不要给医学诊断。\n\n以下是用户长期记忆，只用于个性化回复，不要逐条复述：\n${formatMemories(memories)}`,
      },
      {
        role: "user",
        content: `用户资料：${JSON.stringify({
          nickname: userInfo.nickname,
          goal_weight_kg: userInfo.goal_weight_kg,
          training_frequency: userInfo.training_frequency,
          latest_body_record: latestRecord,
        })}\n\n用户消息：${message}`,
      },
    ],
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const onboardingDraft = normalizeDraft(body.onboardingDraft);

    if (!userId) {
      return NextResponse.json(
        { ok: false, message: "请先登录，再开始聊天。" },
        { status: 400 },
      );
    }

    if (!message) {
      return NextResponse.json(
        { ok: false, message: "请输入消息。" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdmin();

    await saveChatMessage({
      supabase,
      userId,
      role: "user",
      content: message,
    });

    const { data: userInfo, error: userInfoError } = await supabase
      .from("user_info")
      .select("nickname, sex, age, height_cm, goal_weight_kg, training_frequency")
      .eq("user_id", userId)
      .maybeSingle<UserInfo>();

    if (userInfoError) {
      throw new Error(`查询 user_info 失败：${userInfoError.message}`);
    }

    if (!userInfo) {
      return handleOnboardingInChat({
        supabase,
        userId,
        message,
        onboardingDraft,
      });
    }

    const { data: latestRecord, error: latestRecordError } = await supabase
      .from("user_body_record")
      .select(
        "weight_kg, waist_cm, body_fat, estimated_body_fat, bmi, arm_cm, thigh_cm, recorded_at",
      )
      .eq("user_id", userId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle<BodyRecord>();

    if (latestRecordError) {
      throw new Error(`查询 user_body_record 失败：${latestRecordError.message}`);
    }

    const memories = await fetchUserMemories(supabase, userId);
    let bodyUpdate = guardBodyUpdateDecision(
      message,
      await extractBodyUpdate(message),
    );
    const normalizedBodyUpdate = normalizeBodyUpdateWeight({
      message,
      bodyUpdate,
      latestRecord,
    });
    bodyUpdate = normalizedBodyUpdate.bodyUpdate;

    if (normalizedBodyUpdate.confirmationMessage) {
      await saveChatMessage({
        supabase,
        userId,
        role: "assistant",
        content: normalizedBodyUpdate.confirmationMessage,
      });

      return NextResponse.json({
        ok: true,
        type: "body_update_confirmation",
        message: normalizedBodyUpdate.confirmationMessage,
        bodyUpdate,
      });
    }

    const checkinPatch = await createCheckinPatchFromMessage({
      message,
      bodyUpdate,
    });

    if (
      !bodyUpdate.is_body_update ||
      bodyUpdate.subject !== "self" ||
      bodyUpdate.should_save !== true
    ) {
      if (hasCheckinPatch(checkinPatch)) {
        const updatedCheckin = await updateDailyCheckin(
          supabase,
          userId,
          checkinPatch,
        );
        const reply = createCheckinReplyV2({
          patch: checkinPatch,
          checkin: updatedCheckin,
        });

        await saveChatMessage({
          supabase,
          userId,
          role: "assistant",
          content: reply,
        });

        return NextResponse.json({
          ok: true,
          type: "checkin",
          message: reply,
          bodyUpdate,
          checkin: updatedCheckin,
        });
      }

      const reply = await createCompanionReply({
        message,
        userInfo,
        latestRecord,
        memories,
      });

      await saveChatMessage({
        supabase,
        userId,
        role: "assistant",
        content: reply,
      });

      await saveMemoryIfNeeded({
        supabase,
        userId,
        userMessage: message,
        assistantReply: reply,
        bodyUpdate,
      });

      return NextResponse.json({
        ok: true,
        type: "chat",
        message: reply,
        bodyUpdate,
      });
    }

    const validationMessage = validateBodyUpdate(bodyUpdate);

    if (validationMessage) {
      await saveChatMessage({
        supabase,
        userId,
        role: "assistant",
        content: validationMessage,
      });

      await saveMemoryIfNeeded({
        supabase,
        userId,
        userMessage: message,
        assistantReply: validationMessage,
        bodyUpdate,
      });

      return NextResponse.json(
        {
          ok: false,
          type: "body_update",
          message: validationMessage,
          bodyUpdate,
        },
        { status: 400 },
      );
    }

    const metrics = calculateBodyMetrics({
      weightKg: bodyUpdate.weight_kg,
      userInfo,
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const { data: todayWeightRecords, error: todayWeightRecordsError } =
      await supabase
        .from("user_body_record")
        .select(
          "weight_kg, waist_cm, body_fat, estimated_body_fat, bmi, arm_cm, thigh_cm, recorded_at",
        )
        .eq("user_id", userId)
        .not("weight_kg", "is", null)
        .gte("recorded_at", todayStart.toISOString())
        .lt("recorded_at", tomorrowStart.toISOString())
        .order("recorded_at", { ascending: false })
        .returns<BodyRecord[]>();

    if (todayWeightRecordsError) {
      throw new Error(
        `查询今日体重记录失败：${todayWeightRecordsError.message}`,
      );
    }

    const { data: recentWeightRecords, error: recentWeightRecordsError } =
      await supabase
        .from("user_body_record")
        .select(
          "weight_kg, waist_cm, body_fat, estimated_body_fat, bmi, arm_cm, thigh_cm, recorded_at",
        )
        .eq("user_id", userId)
        .not("weight_kg", "is", null)
        .gte("recorded_at", sevenDaysAgo.toISOString())
        .order("recorded_at", { ascending: true })
        .returns<BodyRecord[]>();

    if (recentWeightRecordsError) {
      throw new Error(
        `查询最近7天体重记录失败：${recentWeightRecordsError.message}`,
      );
    }

    const { error: insertError } = await supabase
      .from("user_body_record")
      .insert({
        user_id: userId,
        weight_kg: bodyUpdate.weight_kg,
        waist_cm: bodyUpdate.waist_cm,
        body_fat: bodyUpdate.body_fat,
        bmi: metrics.bmi,
        estimated_body_fat: metrics.estimated_body_fat,
        arm_cm: bodyUpdate.arm_cm,
        thigh_cm: bodyUpdate.thigh_cm,
        recorded_at: new Date().toISOString(),
      });

    if (insertError) {
      throw new Error(`写入 user_body_record 失败：${insertError.message}`);
    }

    const updatedCheckin = hasCheckinPatch(checkinPatch)
      ? await updateDailyCheckin(supabase, userId, checkinPatch)
      : null;
    const checkinReplyParts = createCheckinReplyParts(checkinPatch).filter(
      (part) => !part.startsWith("体重："),
    );
    const reply = createBodyUpdateReplyV3({
      update: bodyUpdate,
      previousRecord: latestRecord,
      metrics,
      todayWeightRecords: todayWeightRecords ?? [],
      recentWeightRecords: recentWeightRecords ?? [],
      checkinParts: checkinReplyParts,
      completedCount: updatedCheckin
        ? countCompletedCheckinItems(updatedCheckin)
        : null,
    });

    await saveChatMessage({
      supabase,
      userId,
      role: "assistant",
      content: reply,
    });

    await saveMemoryIfNeeded({
      supabase,
      userId,
      userMessage: message,
      assistantReply: reply,
      bodyUpdate,
    });

    return NextResponse.json({
      ok: true,
      type: "body_update",
      message: reply,
      bodyUpdate,
      checkin: updatedCheckin,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "聊天请求失败，请稍后重试。";

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: 500 },
    );
  }
}
