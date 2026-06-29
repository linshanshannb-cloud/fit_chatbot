import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createEmptyDailyCheckin,
  getLocalDateString,
  type DailyCheckin,
  type DailyCheckinPatch,
} from "@/lib/daily-checkin";

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

function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizePatch(value: unknown): DailyCheckinPatch {
  if (!value || typeof value !== "object") {
    return {};
  }

  const raw = value as Record<string, unknown>;
  const patch: DailyCheckinPatch = {};

  if (typeof raw.weight_recorded === "boolean") {
    patch.weight_recorded = raw.weight_recorded;
  }

  if ("weight_value" in raw) {
    patch.weight_value = normalizeNumber(raw.weight_value);
  }

  if (typeof raw.strength_done === "boolean") {
    patch.strength_done = raw.strength_done;
  }

  if ("strength_part" in raw) {
    patch.strength_part =
      typeof raw.strength_part === "string" && raw.strength_part.trim()
        ? raw.strength_part.trim()
        : null;
  }

  if (typeof raw.cardio_done === "boolean") {
    patch.cardio_done = raw.cardio_done;
  }

  if ("cardio_type" in raw) {
    patch.cardio_type =
      typeof raw.cardio_type === "string" && raw.cardio_type.trim()
        ? raw.cardio_type.trim()
        : null;
  }

  if ("cardio_duration" in raw) {
    patch.cardio_duration = normalizeNumber(raw.cardio_duration);
  }

  if (["unknown", "low", "normal", "high"].includes(String(raw.water_status))) {
    patch.water_status = raw.water_status as DailyCheckinPatch["water_status"];
  }

  if (
    ["unknown", "low", "normal", "good", "over"].includes(
      String(raw.diet_status),
    )
  ) {
    patch.diet_status = raw.diet_status as DailyCheckinPatch["diet_status"];
  }

  if (
    ["unknown", "low", "normal", "good"].includes(
      String(raw.protein_status),
    )
  ) {
    patch.protein_status =
      raw.protein_status as DailyCheckinPatch["protein_status"];
  }

  return patch;
}

async function getOrCreateDailyCheckin({
  userId,
  date,
}: {
  userId: string;
  date: string;
}) {
  const supabase = createSupabaseAdmin();
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

  const emptyCheckin = createEmptyDailyCheckin(userId, date);
  const { data: inserted, error: insertError } = await supabase
    .from("daily_checkin")
    .insert(emptyCheckin)
    .select("*")
    .single<DailyCheckin>();

  if (insertError) {
    throw new Error(`创建 daily_checkin 失败：${insertError.message}`);
  }

  return inserted;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId")?.trim() ?? "";
    const date = searchParams.get("date")?.trim() || getLocalDateString();

    if (!userId) {
      return NextResponse.json(
        { ok: false, message: "缺少用户标识。" },
        { status: 400 },
      );
    }

    const checkin = await getOrCreateDailyCheckin({ userId, date });

    return NextResponse.json({ ok: true, checkin });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "加载今日打卡失败。";

    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const date =
      typeof body.date === "string" && body.date.trim()
        ? body.date.trim()
        : getLocalDateString();
    const patch = normalizePatch(body.patch);

    if (!userId) {
      return NextResponse.json(
        { ok: false, message: "缺少用户标识。" },
        { status: 400 },
      );
    }

    await getOrCreateDailyCheckin({ userId, date });

    const supabase = createSupabaseAdmin();
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

    return NextResponse.json({ ok: true, checkin: data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "保存今日打卡失败。";

    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
