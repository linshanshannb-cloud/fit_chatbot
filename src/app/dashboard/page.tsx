"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type RangeFilter = "7d" | "30d" | "all";

type UserInfo = {
  nickname: string | null;
  goal_weight_kg: number | string | null;
  training_frequency: string | null;
};

type BodyRecord = {
  id: string;
  weight_kg: number | string | null;
  waist_cm: number | string | null;
  body_fat: number | string | null;
  bmi: number | string | null;
  estimated_body_fat: number | string | null;
  arm_cm: number | string | null;
  thigh_cm: number | string | null;
  recorded_at: string;
};

type DashboardCache = {
  user_id?: string;
  user_info: UserInfo;
  latest_body_record: BodyRecord | null;
  recent_body_records: BodyRecord[];
  updated_at: string;
};

type ChartPoint = {
  date: string;
  value: number;
};

const userIdStorageKey = "fat_loss_user_id";
const loginStorageKey = "fat_loss_logged_in";
const dashboardCacheKey = "dashboard_cache";
const cacheMaxAgeMs = 5 * 60 * 1000;
const pageBackground =
  "bg-[radial-gradient(circle_at_50%_-8%,#f4fbf2_0%,#dfeee0_48%,#d8e9d8_100%)]";
const cardClass =
  "rounded-[34px] bg-white/95 p-5 shadow-[0_20px_46px_rgba(55,86,68,0.14),0_2px_0_rgba(255,255,255,0.95)_inset]";
const softPanelClass =
  "rounded-[30px] bg-white/82 shadow-[0_14px_28px_rgba(75,105,86,0.10),0_1px_0_rgba(255,255,255,0.96)_inset]";

const rangeOptions: Array<{ value: RangeFilter; label: string }> = [
  { value: "7d", label: "7天" },
  { value: "30d", label: "30天" },
  { value: "all", label: "全部" },
];

function toNumber(value: number | string | null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatNumber(value: number | null, digits = 1) {
  return value === null ? "--" : value.toFixed(digits);
}

function formatSignedNumber(value: number | null) {
  if (value === null) return "--";
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createSmoothPath(
  points: Array<ChartPoint & { x: number; y: number }>,
) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;

    const previous = points[index - 1];
    const beforePrevious = points[index - 2] ?? previous;
    const next = points[index + 1] ?? point;
    const controlPoint1X = previous.x + (point.x - beforePrevious.x) / 6;
    const controlPoint1Y = previous.y + (point.y - beforePrevious.y) / 6;
    const controlPoint2X = point.x - (next.x - previous.x) / 6;
    const controlPoint2Y = point.y - (next.y - previous.y) / 6;

    return `${path} C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${point.x} ${point.y}`;
  }, "");
}

function getBodyFatDisplay(record: BodyRecord | null) {
  if (!record) {
    return { value: null, helper: "暂无记录" };
  }

  const measuredBodyFat = toNumber(record.body_fat);
  if (measuredBodyFat !== null) {
    return { value: measuredBodyFat, helper: "用户输入值" };
  }

  return {
    value: toNumber(record.estimated_body_fat),
    helper: "仅供参考",
  };
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
  const latestRecord = records[records.length - 1] ?? null;
  const cache: DashboardCache = {
    user_id: userId,
    user_info: userInfo,
    latest_body_record: latestRecord,
    recent_body_records: records,
    updated_at: new Date().toISOString(),
  };
  window.localStorage.setItem(dashboardCacheKey, JSON.stringify(cache));
}

function isCacheStale(cache: DashboardCache) {
  const updatedAt = new Date(cache.updated_at).getTime();
  if (!Number.isFinite(updatedAt)) return true;
  return Date.now() - updatedAt > cacheMaxAgeMs;
}

function filterRecords(records: BodyRecord[], range: RangeFilter) {
  if (range === "all") return records;

  const days = range === "7d" ? 7 : 30;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);

  return records.filter((record) => new Date(record.recorded_at) >= start);
}

function buildChartPoints(
  records: BodyRecord[],
  key: "weight_kg" | "waist_cm",
): ChartPoint[] {
  const points = records
    .map((record) => {
      const value = toNumber(record[key]);
      return value === null ? null : { date: record.recorded_at, value };
    })
    .filter((point): point is ChartPoint => point !== null);

  const rangeFiltered = points.filter((point) => {
    if (key === "weight_kg") return point.value >= 30 && point.value <= 200;
    return point.value >= 40 && point.value <= 180;
  });

  if (key !== "weight_kg" || rangeFiltered.length < 4) return rangeFiltered;

  const sortedValues = rangeFiltered.map((point) => point.value).sort((a, b) => a - b);
  const median = sortedValues[Math.floor(sortedValues.length / 2)];

  return rangeFiltered.filter((point) => Math.abs(point.value - median) <= 20);
}

function MetricCard({
  label,
  value,
  helper,
  accent = false,
}: {
  label: string;
  value: string;
  helper?: string;
  accent?: boolean;
}) {
  const [mainValue, unit] = value.split(" ");

  return (
    <div className={`${softPanelClass} min-h-[94px] px-4 py-4`}>
      <p className="text-xs font-medium text-ink/45">{label}</p>
      <p
        className={`mt-3 whitespace-nowrap text-xl font-black leading-none tracking-tight ${
          accent ? "text-[#5f9b72]" : "text-ink"
        }`}
      >
        {mainValue}
        {unit ? <span className="ml-1 text-xs font-bold text-ink/54">{unit}</span> : null}
      </p>
      {helper ? <p className="mt-2 text-[11px] leading-4 text-ink/45">{helper}</p> : null}
    </div>
  );
}

function TrendChart({
  title,
  unit,
  points,
}: {
  title: string;
  unit: string;
  points: ChartPoint[];
}) {
  const width = 360;
  const height = 198;
  const paddingX = 20;
  const paddingTop = 34;
  const paddingBottom = 34;
  const values = points.map((point) => point.value);
  const minValue = values.length > 0 ? Math.min(...values) : 0;
  const maxValue = values.length > 0 ? Math.max(...values) : 1;
  const range = maxValue - minValue || 1;

  const coordinates = points.map((point, index) => {
    const x =
      points.length === 1
        ? width / 2
        : paddingX + (index / (points.length - 1)) * (width - paddingX * 2);
    const y =
      height -
      paddingBottom -
      ((point.value - minValue) / range) *
        (height - paddingTop - paddingBottom);

    return { ...point, x, y };
  });

  const path = createSmoothPath(coordinates);
  const areaPath =
    coordinates.length > 0
      ? `${path} L ${coordinates[coordinates.length - 1].x} ${
          height - paddingBottom
        } L ${coordinates[0].x} ${height - paddingBottom} Z`
      : "";
  const trendDiff =
    coordinates.length >= 2
      ? coordinates[coordinates.length - 1].value - coordinates[0].value
      : 0;
  const trendColor =
    trendDiff < -0.2 ? "#5f9b72" : trendDiff > 0.2 ? "#d97745" : "#8a948b";
  const gradientId = `trend-${title}-${unit}`.replace(/[^\w-]/g, "");

  return (
    <div
      className={`${cardClass} transition duration-200 ease-out hover:-translate-y-1 hover:shadow-[0_26px_58px_rgba(55,86,68,0.18),0_2px_0_rgba(255,255,255,0.96)_inset]`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-black leading-tight tracking-tight text-ink">{title}</h2>
          <p className="mt-1 text-sm font-medium text-ink/48">{points.length} 条有效记录</p>
        </div>
        <p className="text-xs font-bold text-ink/48">{unit}</p>
      </div>

      {points.length < 2 ? (
        <div className={`${softPanelClass} mt-5 flex min-h-40 items-center px-4 text-sm leading-6 text-ink/55`}>
          记录多几天后，我会帮你看出更明显的变化趋势。
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="mt-5 h-[210px] w-full overflow-visible"
          role="img"
          aria-label={title}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={trendColor} stopOpacity="0.18" />
              <stop offset="72%" stopColor={trendColor} stopOpacity="0.05" />
              <stop offset="100%" stopColor={trendColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path
            d={path}
            fill="none"
            stroke={trendColor}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
          />
          {coordinates.map((point) => {
            const tooltipX = clamp(point.x - 42, 8, width - 90);
            const tooltipY = clamp(point.y - 76, 18, height - 102);
            const textX = tooltipX + 14;

            return (
              <g
                key={`${point.date}-${point.value}`}
                className="group/point cursor-pointer outline-none"
                tabIndex={0}
              >
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="14"
                  fill="transparent"
                  className="pointer-events-auto"
                />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="3.4"
                  fill={trendColor}
                  className="transition duration-200 group-hover/point:scale-150 group-focus/point:scale-150"
                  style={{ transformBox: "fill-box", transformOrigin: "center" }}
                />
                <g className="pointer-events-none opacity-0 transition duration-200 group-hover/point:opacity-100 group-focus/point:opacity-100">
                  <line
                    x1={point.x}
                    y1={paddingTop - 2}
                    x2={point.x}
                    y2={height - paddingBottom}
                    stroke="#b7c7ba"
                    strokeWidth="1"
                  />
                  <rect
                    x={tooltipX}
                    y={tooltipY}
                    width="84"
                    height="64"
                    rx="16"
                    fill="white"
                    filter="drop-shadow(0px 10px 18px rgba(55,86,68,0.16))"
                  />
                  <text
                    x={textX}
                    y={tooltipY + 24}
                    className="fill-ink/55 text-[13px]"
                  >
                    {formatDate(point.date)}
                  </text>
                  <text
                    x={textX}
                    y={tooltipY + 48}
                    className="fill-ink text-[13px] font-bold"
                  >
                    {point.value.toFixed(1)} {unit}
                  </text>
                </g>
              </g>
            );
          })}
          {coordinates.map((point, index) => (
            <text
              key={`${point.date}-${point.value}-label`}
              x={point.x}
              y={height - 8}
              textAnchor={
                index === 0 ? "start" : index === coordinates.length - 1 ? "end" : "middle"
              }
              className="fill-ink/50 text-[12px] font-medium"
            >
              {index === 0 || index === coordinates.length - 1 || index % 2 === 0
                ? formatDate(point.date)
                : ""}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [records, setRecords] = useState<BodyRecord[]>([]);
  const [range, setRange] = useState<RangeFilter>("30d");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRecordsExpanded, setIsRecordsExpanded] = useState(false);

  useEffect(() => {
    async function loadDashboard() {
      const isLoggedIn = window.localStorage.getItem(loginStorageKey) === "true";
      const userId = window.localStorage.getItem(userIdStorageKey);

      if (!isLoggedIn) {
        router.replace("/login");
        return;
      }

      if (!userId) {
        setMessage("请先完成建档。");
        setIsLoading(false);
        return;
      }

      const cache = readDashboardCache(userId);
      const hasCache = Boolean(cache);

      if (cache) {
        setUserInfo(cache.user_info);
        setRecords(cache.recent_body_records);
        setIsLoading(false);
        setIsSyncing(isCacheStale(cache));
      }

      try {
        const response = await fetch("/api/dashboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });

        const data = await response.json();

        if (!response.ok) {
          if (!hasCache) {
            setMessage(data.message ?? "数据面板加载失败，请稍后重试。");
          }
          return;
        }

        const nextUserInfo = data.userInfo as UserInfo;
        const nextRecords = (data.bodyRecords ?? []) as BodyRecord[];

        setUserInfo(nextUserInfo);
        setRecords(nextRecords);
        setMessage("");
        writeDashboardCache(userId, nextUserInfo, nextRecords);
      } catch (error) {
        if (!hasCache) {
          const reason = error instanceof Error ? error.message : "未知错误";
          setMessage(`数据面板加载失败：${reason}`);
        }
      } finally {
        setIsLoading(false);
        setIsSyncing(false);
      }
    }

    loadDashboard();
  }, [router]);

  const filteredRecords = useMemo(
    () => filterRecords(records, range),
    [records, range],
  );

  const latestRecord = records[records.length - 1] ?? null;
  const firstWeightRecord = records.find(
    (record) => toNumber(record.weight_kg) !== null,
  );
  const currentWeight = latestRecord ? toNumber(latestRecord.weight_kg) : null;
  const firstWeight = firstWeightRecord
    ? toNumber(firstWeightRecord.weight_kg)
    : null;
  const goalWeight = userInfo ? toNumber(userInfo.goal_weight_kg) : null;
  const distanceToGoal =
    currentWeight !== null && goalWeight !== null
      ? currentWeight - goalWeight
      : null;
  const totalChange =
    currentWeight !== null && firstWeight !== null
      ? currentWeight - firstWeight
      : null;
  const bodyFatDisplay = getBodyFatDisplay(latestRecord);

  const weightPoints = buildChartPoints(filteredRecords, "weight_kg");
  const waistPoints = buildChartPoints(filteredRecords, "waist_cm");
  const recentRecords = [...filteredRecords].reverse();
  const visibleRecords = isRecordsExpanded
    ? recentRecords
    : recentRecords.slice(0, 3);
  const canToggleRecords = recentRecords.length > 3;

  if (isLoading) {
    return (
      <section className={`mx-auto min-h-screen w-full max-w-[430px] ${pageBackground} px-4 py-6`}>
        <div className={cardClass}>
          <p className="text-sm text-ink/60">正在加载数据面板...</p>
        </div>
      </section>
    );
  }

  if (message) {
    return (
      <section className={`mx-auto min-h-screen w-full max-w-[430px] ${pageBackground} px-4 py-6`}>
        <div className={cardClass}>
          <h1 className="text-2xl font-black text-ink">数据面板</h1>
          <p className="mt-3 text-sm leading-6 text-ink/60">{message}</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`mx-auto min-h-screen w-full max-w-[430px] ${pageBackground} px-4 pb-28 pt-8 text-ink`}>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4 px-1">
          <div>
            <h1 className="text-[30px] font-black leading-tight tracking-[-0.02em]">数据面板</h1>
            <p className="mt-2 text-sm leading-6 text-ink/58">
              {userInfo?.nickname ? `${userInfo.nickname}，` : ""}
              看看最近的身体趋势。
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-3 rounded-full bg-white/72 p-1 text-xs font-semibold shadow-[0_10px_24px_rgba(75,105,86,0.10),0_1px_0_rgba(255,255,255,0.95)_inset]">
            {rangeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                className={`rounded-full px-3 py-2 transition duration-200 ${
                  range === option.value
                    ? "bg-[#5f9b72] text-white shadow-[0_8px_16px_rgba(95,155,114,0.18)]"
                    : "text-ink/56 hover:bg-white/70"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {isSyncing ? (
          <div className={`${cardClass} py-3 text-sm text-ink/65`}>
            正在同步最新数据
          </div>
        ) : null}

        <div className={cardClass}>
          <p className="text-sm font-semibold text-ink/48">身体状态</p>
          <div className="mt-5 grid grid-cols-3 gap-3">
            <MetricCard label="当前体重" value={`${formatNumber(currentWeight)} kg`} />
            <MetricCard
              label="BMI"
              value={formatNumber(latestRecord ? toNumber(latestRecord.bmi) : null)}
              helper="计算值"
            />
            <MetricCard
              label="体脂率"
              value={`${formatNumber(bodyFatDisplay.value)}%`}
              helper={bodyFatDisplay.helper}
              accent
            />
          </div>
        </div>

        <div className={cardClass}>
          <p className="text-sm font-semibold text-ink/48">目标进度</p>
          <div className="mt-5 grid grid-cols-3 gap-3">
            <MetricCard label="目标体重" value={`${formatNumber(goalWeight)} kg`} />
            <MetricCard
              label="距离目标"
              value={`${formatSignedNumber(distanceToGoal)} kg`}
              helper="当前 - 目标"
            />
            <MetricCard
              label="累计变化"
              value={`${formatSignedNumber(totalChange)} kg`}
              helper="当前 - 最初"
              accent={totalChange !== null && totalChange <= 0}
            />
          </div>
          <p className="mt-5 text-xs leading-5 text-ink/50">
            BMI 与体脂率仅供参考，不能替代专业测量。
          </p>
        </div>

        <TrendChart title="体重趋势" unit="kg" points={weightPoints} />
        <TrendChart title="腰围趋势" unit="cm" points={waistPoints} />

        <div>
          <div className="mb-4 flex items-center justify-between px-1">
            <h2 className="text-xl font-black tracking-tight text-ink">最近记录</h2>
            <p className="text-xs font-semibold text-ink/48">{recentRecords.length} 条记录</p>
          </div>

          {recentRecords.length === 0 ? (
            <p className={`${cardClass} text-sm text-ink/55`}>
              当前时间范围内还没有记录。
            </p>
          ) : (
            <div className="space-y-3 overflow-hidden transition-all duration-300 ease-out">
              {visibleRecords.map((record) => {
                const recordBodyFat = getBodyFatDisplay(record);

                return (
                  <div
                    key={record.id}
                    className="rounded-[30px] bg-white/95 p-4 shadow-[0_14px_28px_rgba(75,105,86,0.10),0_1px_0_rgba(255,255,255,0.95)_inset]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-lg font-black tracking-tight text-[#5f9b72]">
                        {new Intl.DateTimeFormat("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(record.recorded_at))}
                      </p>
                      <span className="rounded-full bg-[#edf2ea] px-3 py-1 text-xs font-bold text-ink/48">
                        {recordBodyFat.helper}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-ink/48">体重</span>
                        <span className="font-bold text-ink">{formatNumber(toNumber(record.weight_kg))} kg</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-ink/48">腰围</span>
                        <span className="font-bold text-ink">{formatNumber(toNumber(record.waist_cm))} cm</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-ink/48">BMI</span>
                        <span className="font-bold text-ink">{formatNumber(toNumber(record.bmi))}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-ink/48">体脂</span>
                        <span className="font-bold text-ink">{formatNumber(recordBodyFat.value)}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {canToggleRecords ? (
                <button
                  type="button"
                  onClick={() => setIsRecordsExpanded((current) => !current)}
                  className="w-full rounded-[24px] bg-white/80 px-4 py-3 text-sm font-bold text-[#5f9b72] shadow-[0_12px_24px_rgba(75,105,86,0.08),0_1px_0_rgba(255,255,255,0.95)_inset] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-white"
                >
                  {isRecordsExpanded ? "收起历史记录 ↑" : "查看更多历史记录 ↓"}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
