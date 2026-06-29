import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

type UserInfoForMetrics = {
  sex: string | null;
  age: number | string | null;
  height_cm: number | string | null;
};

const alreadyOnboardedMessage = "检测到您已经完成建档，无需重复建档。";
const requiredFields: Array<keyof OnboardingProfile> = [
  "nickname",
  "sex",
  "age",
  "height_cm",
  "weight_kg",
  "goal_weight_kg",
];
const fieldLabels: Record<keyof OnboardingProfile, string> = {
  nickname: "昵称",
  sex: "性别",
  age: "年龄",
  height_cm: "身高",
  weight_kg: "当前体重",
  waist_cm: "腰围",
  goal_weight_kg: "目标体重",
  training_frequency: "训练频率",
};

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

function getModelEndpoint() {
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.deepseek.com";
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
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

function createEmptyDraft(): OnboardingProfile {
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

function normalizeDraft(value: unknown) {
  if (!value || typeof value !== "object") {
    return createEmptyDraft();
  }

  return normalizeProfile(value as Record<string, unknown>);
}

function mergeDraft(
  currentDraft: OnboardingProfile,
  extractedProfile: OnboardingProfile,
) {
  const nextDraft = { ...currentDraft };

  (Object.keys(nextDraft) as Array<keyof OnboardingProfile>).forEach((field) => {
    const value = extractedProfile[field];

    if (value !== null && value !== "") {
      (
        nextDraft as Record<keyof OnboardingProfile, string | number | null>
      )[field] = value;
    }
  });

  return nextDraft;
}

function readWeightFromInput(input: string, keywords: string[]) {
  const keywordPattern = keywords.join("|");
  const patterns = [
    new RegExp(
      `(?:${keywordPattern})[^，。,.!?！？]{0,12}?(\\d+(?:\\.\\d+)?)\\s*(kg|公斤|千克|斤)?`,
      "i",
    ),
    new RegExp(
      `(\\d+(?:\\.\\d+)?)\\s*(kg|公斤|千克|斤)?[^，。,.!?！？]{0,8}(?:${keywordPattern})`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);

    if (!match) {
      continue;
    }

    const rawValue = Number(match[1]);
    const unit = match[2]?.toLowerCase();

    if (!Number.isFinite(rawValue)) {
      continue;
    }

    if (unit === "kg" || unit === "公斤" || unit === "千克") {
      return rawValue;
    }

    if (unit === "斤" || !unit) {
      return Number((rawValue / 2).toFixed(1));
    }
  }

  return null;
}

function applyWeightUnitHints(input: string, profile: OnboardingProfile) {
  const nextProfile = { ...profile };
  const currentWeight = readWeightFromInput(input, [
    "体重",
    "当前",
    "现在",
    "空腹",
  ]);
  const goalWeight = readWeightFromInput(input, ["目标", "想到", "减到"]);

  if (currentWeight !== null && nextProfile.weight_kg !== null) {
    nextProfile.weight_kg = currentWeight;
  }

  if (goalWeight !== null && nextProfile.goal_weight_kg !== null) {
    nextProfile.goal_weight_kg = goalWeight;
  }

  return nextProfile;
}

function getMissingFields(profile: OnboardingProfile) {
  return requiredFields.filter((field) => {
    const value = profile[field];
    return value === null || value === undefined || value === "";
  });
}

function validateProfile(profile: OnboardingProfile) {
  const missingFields = getMissingFields(profile);

  if (missingFields.length > 0) {
    return {
      ok: false,
      missingFields,
      message: `还差这些建档信息：${missingFields
        .map((field) => fieldLabels[field])
        .join("、")}。你可以一次性告诉我，我再帮你完成建档。`,
    };
  }

  if (
    profile.weight_kg !== null &&
    (profile.weight_kg < 30 || profile.weight_kg > 200)
  ) {
    return {
      ok: false,
      missingFields: [],
      message: "你输入的体重可能异常，请确认后再提交，我先不写入建档。",
    };
  }

  if (
    profile.height_cm !== null &&
    (profile.height_cm < 120 || profile.height_cm > 230)
  ) {
    return {
      ok: false,
      missingFields: [],
      message: "你输入的身高可能异常，请确认后再提交，我先不写入建档。",
    };
  }

  if (
    profile.waist_cm !== null &&
    (profile.waist_cm < 40 || profile.waist_cm > 180)
  ) {
    return {
      ok: false,
      missingFields: [],
      message: "你输入的腰围可能异常，请确认后再提交，我先不写入建档。",
    };
  }

  return {
    ok: true,
    missingFields: [],
    message: "",
  };
}

function parseJsonObject(content: string) {
  return JSON.parse(
    content
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, ""),
  ) as Record<string, unknown>;
}

async function extractProfile(input: string): Promise<OnboardingProfile> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("缺少 OPENAI_API_KEY，请先在 .env.local 中配置 DeepSeek API Key。");
  }

  let response: Response;

  try {
    response = await fetch(getModelEndpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        response_format: { type: "json_object" },
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
        temperature: 0,
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
    throw new Error("DeepSeek API 响应中缺少可解析的建档内容。");
  }

  try {
    return normalizeProfile(parseJsonObject(content));
  } catch {
    throw new Error("DeepSeek API 返回的建档内容不是有效 JSON。");
  }
}

async function hasUserInfo(userId: string) {
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_info")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`查询 user_info 失败：${error.message}`);
  }

  return Boolean(data);
}

function calculateBodyMetrics({
  weightKg,
  userInfo,
}: {
  weightKg: number | null;
  userInfo: UserInfoForMetrics;
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
    const rawEstimate =
      sex === "male"
        ? 1.2 * bmi + 0.23 * age - 16.2
        : 1.2 * bmi + 0.23 * age - 5.4;
    estimatedBodyFat = Number(rawEstimate.toFixed(1));
  }

  return {
    bmi,
    estimated_body_fat: estimatedBodyFat,
  };
}

function alreadyOnboardedResponse() {
  return NextResponse.json(
    {
      ok: false,
      code: "already_onboarded",
      alreadyOnboarded: true,
      message: alreadyOnboardedMessage,
    },
    { status: 409 },
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId")?.trim() ?? "";

    if (!userId) {
      return NextResponse.json(
        { ok: false, message: "缺少用户标识，请刷新页面后重试。" },
        { status: 400 },
      );
    }

    const exists = await hasUserInfo(userId);

    return NextResponse.json({
      ok: true,
      exists,
      message: exists ? alreadyOnboardedMessage : "",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "检查建档状态失败，请稍后重试。";

    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = typeof body.input === "string" ? body.input.trim() : "";
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const onboardingDraft = normalizeDraft(body.onboardingDraft);

    if (!userId) {
      return NextResponse.json(
        { ok: false, message: "缺少用户标识，请刷新页面后重试。" },
        { status: 400 },
      );
    }

    if (await hasUserInfo(userId)) {
      return alreadyOnboardedResponse();
    }

    if (!input) {
      return NextResponse.json(
        { ok: false, onboardingDraft, message: "请先输入基础信息。" },
        { status: 400 },
      );
    }

    const extractedProfile = applyWeightUnitHints(input, await extractProfile(input));
    const profile = mergeDraft(onboardingDraft, extractedProfile);
    const validation = validateProfile(profile);

    if (!validation.ok) {
      return NextResponse.json(
        {
          ok: false,
          profile,
          onboardingDraft: profile,
          missingFields: validation.missingFields,
          message: validation.message,
        },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdmin();

    const { error: userInfoError } = await supabase.from("user_info").insert({
      user_id: userId,
      nickname: profile.nickname,
      sex: profile.sex,
      age: profile.age,
      height_cm: profile.height_cm,
      goal_weight_kg: profile.goal_weight_kg,
      training_frequency: profile.training_frequency,
    });

    if (userInfoError) {
      throw new Error(`写入 user_info 失败：${userInfoError.message}`);
    }

    const metrics = calculateBodyMetrics({
      weightKg: profile.weight_kg,
      userInfo: {
        sex: profile.sex,
        age: profile.age,
        height_cm: profile.height_cm,
      },
    });

    const { error: bodyRecordError } = await supabase
      .from("user_body_record")
      .insert({
        user_id: userId,
        weight_kg: profile.weight_kg,
        waist_cm: profile.waist_cm,
        body_fat: null,
        bmi: metrics.bmi,
        estimated_body_fat: metrics.estimated_body_fat,
        arm_cm: null,
        thigh_cm: null,
      });

    if (bodyRecordError) {
      throw new Error(`写入 user_body_record 失败：${bodyRecordError.message}`);
    }

    return NextResponse.json({
      ok: true,
      profile,
      onboardingDraft: null,
      message:
        "我已经记住你的基础信息了，之后你可以直接告诉我体重、饮食、训练情况，我会持续帮你分析。",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "建档失败，请稍后重试。";

    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
