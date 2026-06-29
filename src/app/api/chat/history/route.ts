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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId")?.trim() ?? "";
    const before = searchParams.get("before")?.trim();
    const limitParam = Number(searchParams.get("limit") ?? "30");
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 50)
      : 30;

    if (!userId) {
      return NextResponse.json(
        { ok: false, message: "请先完成建档。" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdmin();
    let query = supabase
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt("created_at", before);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`查询 chat_messages 失败：${error.message}`);
    }

    return NextResponse.json({
      ok: true,
      messages: (data ?? []).reverse(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "聊天记录加载失败，请稍后重试。";

    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
