"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  countCompletedCheckinItems,
  createEmptyDailyCheckin,
  type DailyCheckin,
  type DailyCheckinPatch,
} from "@/lib/daily-checkin";

type UserInfo = {
  nickname: string | null;
  goal_weight_kg: number | string | null;
};

type BodyRecord = {
  weight_kg: number | string | null;
  waist_cm?: number | string | null;
  recorded_at: string;
};

type DashboardCache = {
  user_id?: string;
  user_info: UserInfo;
  latest_body_record: BodyRecord | null;
  recent_body_records: BodyRecord[];
  updated_at: string;
};

type CheckinEditTarget = "strength" | "cardio" | "water" | "diet" | null;
type CheckinIconName = "scale" | "strength" | "cardio" | "water" | "food";
type CheckinCardState = {
  completed: boolean;
  value?: string;
  source: "manual" | "chat";
};

const userIdStorageKey = "fat_loss_user_id";
const loginStorageKey = "fat_loss_logged_in";
const dashboardCacheKey = "dashboard_cache";
const chatNoticeStorageKey = "chat_notice";
const cardClass =
  "rounded-[34px] bg-white/95 p-5 shadow-[0_20px_46px_rgba(55,86,68,0.14),0_2px_0_rgba(255,255,255,0.95)_inset]";
const statCardClass =
  "rounded-[28px] bg-white/86 shadow-[0_14px_28px_rgba(75,105,86,0.10),0_1px_0_rgba(255,255,255,0.96)_inset]";

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatNumber(value: number | null) {
  return value === null ? "--" : value.toFixed(1);
}

function formatChange(value: number | null, unit: string) {
  if (value === null) return "--";
  if (value === 0) return `0 ${unit}`;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} ${unit}`;
}

function formatRecordDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function readDashboardCache(userId: string) {
  const rawCache = window.localStorage.getItem(dashboardCacheKey);
  if (!rawCache) return null;

  try {
    const cache = JSON.parse(rawCache) as DashboardCache;
    if (cache.user_id && cache.user_id !== userId) return null;
    if (!cache.user_info || !Array.isArray(cache.recent_body_records)) return null;
    return cache;
  } catch {
    return null;
  }
}

function writeDashboardCache(
  userId: string,
  userInfo: UserInfo,
  records: BodyRecord[],
) {
  const cache: DashboardCache = {
    user_id: userId,
    user_info: userInfo,
    latest_body_record: records[records.length - 1] ?? null,
    recent_body_records: records,
    updated_at: new Date().toISOString(),
  };
  window.localStorage.setItem(dashboardCacheKey, JSON.stringify(cache));
}

function CheckinIcon({ name }: { name: CheckinIconName }) {
  const common = {
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d9f1dd] text-[#5f9b72] shadow-[0_8px_18px_rgba(83,129,101,0.12)]">
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {name === "scale" ? (
          <>
            <path d="M12 4v3" {...common} />
            <path d="M5 8h14" {...common} />
            <path d="M7 8l-3 6h6L7 8Z" {...common} />
            <path d="M17 8l-3 6h6l-3-6Z" {...common} />
            <path d="M12 7v12" {...common} />
            <path d="M8 19h8" {...common} />
          </>
        ) : null}
        {name === "strength" ? (
          <>
            <path d="M6 8v8M18 8v8" {...common} />
            <path d="M3.5 10v4M20.5 10v4" {...common} />
            <path d="M6 12h12" {...common} />
          </>
        ) : null}
        {name === "cardio" ? (
          <>
            <circle cx="7" cy="16" r="3" {...common} />
            <circle cx="17" cy="16" r="3" {...common} />
            <path d="M9.5 16h3l2-5H11l-2 5Z" {...common} />
            <path d="M12 8h3" {...common} />
          </>
        ) : null}
        {name === "water" ? (
          <path
            d="M12 3.5c3.4 4.1 5.2 7.1 5.2 10A5.2 5.2 0 0 1 6.8 13.5c0-2.9 1.8-5.9 5.2-10Z"
            {...common}
          />
        ) : null}
        {name === "food" ? (
          <>
            <path d="M7 4v7M10 4v7M7 8h3M8.5 11v9" {...common} />
            <path d="M16 4v16" {...common} />
            <path d="M16 4c2 1.2 3 3 3 5.4 0 2-1.1 3.5-3 4.1" {...common} />
          </>
        ) : null}
      </svg>
    </span>
  );
}

function MiniStat({
  label,
  value,
  helper,
  valueClassName = "text-ink",
}: {
  label: string;
  value: string;
  helper?: string;
  valueClassName?: string;
}) {
  return (
    <div className={`${statCardClass} min-h-[92px] px-4 py-4`}>
      <p className="text-xs font-medium text-ink/48">{label}</p>
      <p className={`mt-2 text-xl font-bold leading-none tracking-tight ${valueClassName}`}>
        {value}
      </p>
      {helper ? <p className="mt-2 text-[11px] leading-4 text-ink/42">{helper}</p> : null}
    </div>
  );
}

function CheckinItem({
  icon,
  title,
  status,
  detail,
  active,
  onClick,
}: {
  icon: CheckinIconName;
  title: string;
  status: string;
  detail?: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative min-h-[150px] rounded-[28px] p-4 text-left transition duration-200 ease-out hover:-translate-y-1 active:translate-y-0 ${
        active
          ? "bg-[#e9f8eb] text-ink shadow-[0_18px_34px_rgba(83,129,101,0.16),0_1px_0_rgba(255,255,255,0.92)_inset]"
          : "bg-white/70 text-ink/72 shadow-[0_14px_28px_rgba(75,105,86,0.08),0_1px_0_rgba(255,255,255,0.9)_inset]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <CheckinIcon name={icon} />
        {active ? (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#5f9b72] text-xs font-bold text-white shadow-[0_8px_16px_rgba(95,155,114,0.28)]">
            ✓
          </span>
        ) : null}
      </div>
      <p className="mt-5 text-xs font-medium text-ink/50">{title}</p>
      {detail ? (
        <p className="mt-1 text-base font-black leading-tight tracking-tight text-ink">
          {detail}
        </p>
      ) : null}
      <p className={`mt-2 text-[11px] font-medium ${active ? "text-[#5f9b72]" : "text-ink/45"}`}>
        {status}
      </p>
    </button>
  );
}

function waterLabel(status: DailyCheckin["water_status"]) {
  return { unknown: "未记录", low: "不足", normal: "正常", high: "较多" }[status];
}

function dietLabel(status: DailyCheckin["diet_status"]) {
  return {
    unknown: "未记录",
    low: "不足",
    normal: "一般",
    good: "达标",
    over: "放纵",
  }[status];
}

function proteinLabel(status: DailyCheckin["protein_status"]) {
  return { unknown: "未记录", low: "不足", normal: "一般", good: "达标" }[status];
}

function createTodaySummary(checkin: DailyCheckin) {
  const completedCount = countCompletedCheckinItems(checkin);
  if (completedCount === 5) return "今天所有任务都完成啦！继续保持。";
  if (completedCount === 0) {
    return "今天还没有开始记录，和我聊一句，我可以帮你自动完成记录。";
  }

  const missingItems = [
    checkin.weight_recorded ? null : "体重",
    checkin.strength_done ? null : "力量训练",
    checkin.cardio_done ? null : "有氧",
    checkin.water_status !== "unknown" ? null : "饮水",
    checkin.diet_status !== "unknown" || checkin.protein_status !== "unknown"
      ? null
      : "饮食",
  ].filter((item): item is string => Boolean(item));

  return `今天已完成${completedCount}项任务。还差${missingItems.join("、")}记录，继续保持。`;
}

export default function HomePage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [records, setRecords] = useState<BodyRecord[]>([]);
  const [checkin, setCheckin] = useState<DailyCheckin | null>(null);
  const [editTarget, setEditTarget] = useState<CheckinEditTarget>(null);
  const [customValue, setCustomValue] = useState("");
  const [cardioDuration, setCardioDuration] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  async function loadCheckin(nextUserId: string) {
    const response = await fetch(`/api/checkin?userId=${encodeURIComponent(nextUserId)}`);
    const data = await response.json();
    setCheckin(response.ok ? (data.checkin as DailyCheckin) : createEmptyDailyCheckin(nextUserId));
  }

  async function saveCheckinPatch(patch: DailyCheckinPatch) {
    if (!userId) return;

    const response = await fetch("/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, patch }),
    });
    const data = await response.json();
    if (response.ok) setCheckin(data.checkin as DailyCheckin);
    setEditTarget(null);
    setCustomValue("");
    setCardioDuration("");
  }

  useEffect(() => {
    async function loadCurrentData() {
      const isLoggedIn = window.localStorage.getItem(loginStorageKey) === "true";
      const nextUserId = window.localStorage.getItem(userIdStorageKey);
      if (!isLoggedIn || !nextUserId) {
        router.replace("/login");
        return;
      }

      setUserId(nextUserId);
      const cache = readDashboardCache(nextUserId);
      if (cache) {
        setUserInfo(cache.user_info);
        setRecords(cache.recent_body_records);
        setIsLoading(false);
      }

      try {
        const onboardingResponse = await fetch(
          `/api/onboarding?userId=${encodeURIComponent(nextUserId)}`,
        );
        const onboardingData = await onboardingResponse.json();
        if (onboardingResponse.ok && !onboardingData.exists) {
          window.sessionStorage.setItem(
            chatNoticeStorageKey,
            "检测到你还没有完成建档。直接告诉我昵称、性别、年龄、身高、当前体重、腰围、目标体重和训练频率，我会帮你记录。",
          );
          router.replace("/chat");
          return;
        }

        const [dashboardResponse] = await Promise.all([
          fetch("/api/dashboard", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: nextUserId }),
          }),
          loadCheckin(nextUserId),
        ]);
        const dashboardData = await dashboardResponse.json();
        if (dashboardResponse.ok) {
          const nextUserInfo = dashboardData.userInfo as UserInfo;
          const nextRecords = (dashboardData.bodyRecords ?? []) as BodyRecord[];
          setUserInfo(nextUserInfo);
          setRecords(nextRecords);
          writeDashboardCache(nextUserId, nextUserInfo, nextRecords);
        }
      } finally {
        setIsLoading(false);
      }
    }

    loadCurrentData();
  }, [router]);

  const latestRecord = records[records.length - 1] ?? null;
  const firstRecord = records.find((record) => toNumber(record.weight_kg) !== null);
  const latestWaistRecord = [...records]
    .reverse()
    .find((record) => toNumber(record.waist_cm) !== null);
  const todayWeightRecord = [...records].reverse().find((record) => {
    const weight = toNumber(record.weight_kg);
    return weight !== null && isSameDay(new Date(record.recorded_at), new Date());
  });
  const currentWeight = latestRecord ? toNumber(latestRecord.weight_kg) : null;
  const latestWaist = latestWaistRecord ? toNumber(latestWaistRecord.waist_cm) : null;
  const firstWeight = firstRecord ? toNumber(firstRecord.weight_kg) : null;
  const goalWeight = userInfo ? toNumber(userInfo.goal_weight_kg) : null;
  const weightChange =
    currentWeight !== null && firstWeight !== null ? currentWeight - firstWeight : null;
  const todayCheckin = checkin ?? createEmptyDailyCheckin(userId || "local");
  const todayWeightValue =
    todayCheckin.weight_recorded && todayCheckin.weight_value !== null
      ? toNumber(todayCheckin.weight_value)
      : todayWeightRecord
        ? toNumber(todayWeightRecord.weight_kg)
        : null;
  const todayWeightRecorded = todayWeightValue !== null;
  const completedCheckin = {
    ...todayCheckin,
    weight_recorded: todayWeightRecorded || todayCheckin.weight_recorded,
    weight_value: todayWeightValue ?? todayCheckin.weight_value,
  };
  const todaySummary = createTodaySummary(completedCheckin);
  const weightCard: CheckinCardState = {
    completed: todayWeightRecorded,
    value: todayWeightRecorded ? `${formatNumber(todayWeightValue)}kg` : undefined,
    source: "chat",
  };
  const strengthCard: CheckinCardState = {
    completed: todayCheckin.strength_done,
    value: todayCheckin.strength_part ?? (todayCheckin.strength_done ? "已完成" : undefined),
    source: "manual",
  };
  const cardioCard: CheckinCardState = {
    completed: todayCheckin.cardio_done,
    value: todayCheckin.cardio_done
      ? [
          todayCheckin.cardio_type ?? "已完成",
          todayCheckin.cardio_duration ? `${todayCheckin.cardio_duration}min` : null,
        ]
          .filter(Boolean)
          .join(" ")
      : undefined,
    source: "manual",
  };
  const waterCard: CheckinCardState = {
    completed: todayCheckin.water_status !== "unknown",
    value:
      todayCheckin.water_status !== "unknown"
        ? waterLabel(todayCheckin.water_status)
        : undefined,
    source: "manual",
  };
  const dietCard: CheckinCardState = {
    completed:
      todayCheckin.diet_status !== "unknown" ||
      todayCheckin.protein_status !== "unknown",
    value:
      todayCheckin.protein_status !== "unknown"
        ? `蛋白质：${proteinLabel(todayCheckin.protein_status)}`
        : todayCheckin.diet_status !== "unknown"
          ? dietLabel(todayCheckin.diet_status)
          : undefined,
    source: "manual",
  };

  const progress = useMemo(() => {
    if (currentWeight === null || goalWeight === null) return 0;
    if (firstWeight === null || firstWeight === goalWeight) {
      return currentWeight <= goalWeight ? 100 : 0;
    }
    const rawProgress = ((firstWeight - currentWeight) / (firstWeight - goalWeight)) * 100;
    return Math.min(100, Math.max(0, rawProgress));
  }, [currentWeight, firstWeight, goalWeight]);

  return (
    <section className="min-h-screen bg-[radial-gradient(circle_at_50%_-8%,#f4fbf2_0%,#dfeee0_48%,#d8e9d8_100%)] px-4 pb-28 pt-5 text-ink">
      <div className="space-y-5">
        <div className="px-1 pb-1 pt-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#dff2e4] px-3 py-1.5 text-[11px] font-semibold text-[#5f9b72] shadow-[0_8px_18px_rgba(95,155,114,0.10)]">
            ✧ AI 减脂陪伴
          </span>
          <h1 className="mt-4 text-[28px] font-black leading-tight tracking-[-0.01em]">
            少记录，多聊天
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink/58">
            一句话，也能完成今天的记录。
          </p>
        </div>

        <div className={cardClass}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-ink/45">用户信息</p>
              <h2 className="mt-1 text-2xl font-black leading-none tracking-tight">
                {userInfo?.nickname ?? "未建档用户"}
              </h2>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#e6f6e8] px-3 py-1.5 text-[11px] font-bold text-[#5f9b72]">
              ⚡ 自动记录中
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <MiniStat
              label="当前体重"
              value={isLoading ? "加载中" : `${formatNumber(currentWeight)} kg`}
            />
            <MiniStat
              label="目标体重"
              value={`${formatNumber(goalWeight)} kg`}
              valueClassName="text-[#5f9b72]"
            />
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs font-medium text-ink/50">
              <span>完成进度</span>
              <span className="text-ink/70">{Math.round(progress)}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-[#e5ebdf]">
              <div
                className="h-full rounded-full bg-[#5f9b72] transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        <div className={cardClass}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-ink/45">身体趋势</p>
              <h2 className="mt-1 text-xl font-black tracking-tight">阶段变化</h2>
            </div>
            <span className="rounded-full bg-[#eef7e9] px-3 py-1 text-[11px] font-bold text-ink/46">
              {records.length} 条记录
            </span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <MiniStat
              label="体重变化"
              value={formatChange(weightChange, "kg")}
              valueClassName={weightChange !== null && weightChange <= 0 ? "text-[#5f9b72]" : "text-[#d97847]"}
            />
            <MiniStat
              label="腰围变化"
              value={latestWaist !== null ? `${formatNumber(latestWaist)} cm` : "--"}
              helper={
                latestWaistRecord
                  ? `最近记录：${formatRecordDate(latestWaistRecord.recorded_at)}`
                  : "暂无有效记录"
              }
            />
          </div>
        </div>

        <div className={cardClass}>
          <p className="text-xs font-medium text-ink/45">今日打卡</p>
          <h2 className="mt-1 text-xl font-black tracking-tight">
            和我说一句，也可以自动记录
          </h2>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <CheckinItem
              icon="scale"
              title="今日体重"
              status={weightCard.completed ? "✓ 已记录" : "未记录"}
              detail={weightCard.value}
              active={weightCard.completed}
            />
            <CheckinItem
              icon="strength"
              title="力量训练"
              status={strengthCard.completed ? "✓ 已完成" : "未完成"}
              detail={strengthCard.value}
              active={strengthCard.completed}
              onClick={() => setEditTarget("strength")}
            />
            <CheckinItem
              icon="cardio"
              title="有氧训练"
              status={cardioCard.completed ? "✓ 已完成" : "未完成"}
              detail={cardioCard.value}
              active={cardioCard.completed}
              onClick={() => setEditTarget("cardio")}
            />
            <CheckinItem
              icon="water"
              title="饮水情况"
              status={waterCard.completed ? waterLabel(todayCheckin.water_status) : "未记录"}
              detail={waterCard.value}
              active={waterCard.completed}
              onClick={() => setEditTarget("water")}
            />
            <CheckinItem
              icon="food"
              title="饮食/蛋白质"
              status={dietCard.completed ? "✓ 已记录" : "未记录"}
              detail={dietCard.value}
              active={dietCard.completed}
              onClick={() => setEditTarget("diet")}
            />
          </div>
        </div>

        <div className={cardClass}>
          <p className="text-xs font-medium text-ink/45">AI 今日总结</p>
          <p className="mt-2 text-base font-bold leading-7 text-ink">{todaySummary}</p>
        </div>
      </div>

      {editTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/20 px-4 pb-5 backdrop-blur-sm">
          <div className="w-full max-w-[398px] rounded-[32px] bg-white/95 p-5 shadow-[0_24px_60px_rgba(35,47,39,0.22)]">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">
                {editTarget === "strength"
                  ? "力量训练"
                  : editTarget === "cardio"
                    ? "有氧训练"
                    : editTarget === "water"
                      ? "饮水情况"
                      : "饮食/蛋白质"}
              </h3>
              <button type="button" onClick={() => setEditTarget(null)} className="rounded-full px-3 py-2 text-sm text-ink/50">
                关闭
              </button>
            </div>

            {editTarget === "strength" ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {["未完成", "胸部", "背部", "腿部", "肩部", "手臂", "胸+三头", "背+二头"].map((part) => (
                  <button
                    key={part}
                    type="button"
                    onClick={() => saveCheckinPatch({ strength_done: part !== "未完成", strength_part: part === "未完成" ? null : part })}
                    className="rounded-[20px] bg-[#f1f7ef] px-3 py-3 text-sm font-medium transition hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(73,111,88,0.12)]"
                  >
                    {part}
                  </button>
                ))}
                <input value={customValue} onChange={(event) => setCustomValue(event.target.value)} placeholder="自定义部位" className="col-span-2 rounded-[20px] bg-[#f1f7ef] px-4 py-3 text-sm outline-none" />
                <button type="button" onClick={() => saveCheckinPatch({ strength_done: Boolean(customValue.trim()), strength_part: customValue.trim() || null })} className="col-span-2 rounded-[20px] bg-[#5f9b72] px-4 py-3 text-sm font-bold text-white">
                  保存自定义
                </button>
              </div>
            ) : null}

            {editTarget === "cardio" ? (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {["未完成", "跑步机", "动感单车", "户外跑", "快走", "爬坡"].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setCustomValue(type === "未完成" ? "" : type);
                        if (type === "未完成") saveCheckinPatch({ cardio_done: false, cardio_type: null, cardio_duration: null });
                      }}
                      className="rounded-[20px] bg-[#f1f7ef] px-3 py-3 text-sm font-medium transition hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(73,111,88,0.12)]"
                    >
                      {type}
                    </button>
                  ))}
                </div>
                <input value={customValue} onChange={(event) => setCustomValue(event.target.value)} placeholder="有氧类型" className="w-full rounded-[20px] bg-[#f1f7ef] px-4 py-3 text-sm outline-none" />
                <input value={cardioDuration} onChange={(event) => setCardioDuration(event.target.value)} inputMode="numeric" placeholder="时长（分钟）" className="w-full rounded-[20px] bg-[#f1f7ef] px-4 py-3 text-sm outline-none" />
                <button type="button" onClick={() => saveCheckinPatch({ cardio_done: Boolean(customValue.trim()), cardio_type: customValue.trim() || null, cardio_duration: toNumber(cardioDuration) })} className="w-full rounded-[20px] bg-[#5f9b72] px-4 py-3 text-sm font-bold text-white">
                  保存
                </button>
              </div>
            ) : null}

            {editTarget === "water" ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {[
                  ["未记录", "unknown"],
                  ["不足", "low"],
                  ["正常", "normal"],
                  ["较多", "high"],
                ].map(([label, value]) => (
                  <button key={value} type="button" onClick={() => saveCheckinPatch({ water_status: value as DailyCheckin["water_status"] })} className="rounded-[20px] bg-[#f1f7ef] px-3 py-3 text-sm font-medium transition hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(73,111,88,0.12)]">
                    {label}
                  </button>
                ))}
              </div>
            ) : null}

            {editTarget === "diet" ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {[
                  ["未记录", "unknown"],
                  ["不足", "low"],
                  ["一般", "normal"],
                  ["达标", "good"],
                  ["放纵", "over"],
                ].map(([label, value]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      saveCheckinPatch({
                        diet_status: value as DailyCheckin["diet_status"],
                        protein_status: value === "good" ? "good" : "unknown",
                      })
                    }
                    className="rounded-[20px] bg-[#f1f7ef] px-3 py-3 text-sm font-medium transition hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(73,111,88,0.12)]"
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
