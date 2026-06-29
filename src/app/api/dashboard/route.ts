import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";

    if (!userId) {
      return NextResponse.json(
        { ok: false, message: "请先完成建档。" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdmin();

    const { data: userInfo, error: userInfoError } = await supabase
      .from("user_info")
      .select(
        "user_id, nickname, sex, age, height_cm, goal_weight_kg, training_frequency, created_at, updated_at",
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (userInfoError) {
      throw new Error(`查询 user_info 失败：${userInfoError.message}`);
    }

    if (!userInfo) {
      return NextResponse.json(
        { ok: false, message: "请先完成建档。" },
        { status: 400 },
      );
    }

    const { data: bodyRecords, error: bodyRecordsError } = await supabase
      .from("user_body_record")
      .select(
        "id, user_id, weight_kg, waist_cm, body_fat, bmi, estimated_body_fat, arm_cm, thigh_cm, recorded_at, created_at",
      )
      .eq("user_id", userId)
      .order("recorded_at", { ascending: true });

    if (bodyRecordsError) {
      throw new Error(
        `查询 user_body_record 失败：${bodyRecordsError.message}`,
      );
    }

    return NextResponse.json({
      ok: true,
      userInfo,
      bodyRecords: bodyRecords ?? [],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "数据面板加载失败，请稍后重试。";

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: 500 },
    );
  }
}
