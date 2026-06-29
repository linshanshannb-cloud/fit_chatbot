"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type OnboardingDraft = {
  nickname: string | null;
  sex: string | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  waist_cm: number | null;
  goal_weight_kg: number | null;
  training_frequency: string | null;
};

const userIdStorageKey = "fat_loss_user_id";
const chatNoticeStorageKey = "chat_notice";
const onboardingDraftStorageKey = "onboarding_draft";
const alreadyOnboardedMessage = "检测到您已经完成建档，无需重复建档。";
const exampleInput =
  "叫我阿山，男，29岁，173cm，现在100.6kg，腰围93cm，目标85kg，一周练4次。";

function createUserId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `fat_loss_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function getOrCreateUserId() {
  const existingUserId = window.localStorage.getItem(userIdStorageKey);

  if (existingUserId) {
    return existingUserId;
  }

  const userId = createUserId();
  window.localStorage.setItem(userIdStorageKey, userId);
  return userId;
}

function readOnboardingDraft() {
  const rawDraft = window.localStorage.getItem(onboardingDraftStorageKey);

  if (!rawDraft) {
    return null;
  }

  try {
    return JSON.parse(rawDraft) as OnboardingDraft;
  } catch {
    window.localStorage.removeItem(onboardingDraftStorageKey);
    return null;
  }
}

export default function OnboardingPage() {
  const router = useRouter();
  const [input, setInput] = useState(exampleInput);
  const [userId, setUserId] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [isChecking, setIsChecking] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function redirectToChatWithNotice(notice = alreadyOnboardedMessage) {
    window.sessionStorage.setItem(chatNoticeStorageKey, notice);
    router.replace("/chat");
  }

  useEffect(() => {
    async function checkOnboardingStatus() {
      const nextUserId = getOrCreateUserId();
      setUserId(nextUserId);

      try {
        const response = await fetch(
          `/api/onboarding?userId=${encodeURIComponent(nextUserId)}`,
        );
        const data = await response.json();

        if (response.ok && data.exists) {
          redirectToChatWithNotice(data.message || alreadyOnboardedMessage);
          return;
        }
      } catch {
        setMessage("暂时无法检查建档状态，你仍可以继续提交建档信息。");
        setStatus("error");
      } finally {
        setIsChecking(false);
      }
    }

    checkOnboardingStatus();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setStatus("idle");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input,
          userId,
          onboardingDraft: readOnboardingDraft(),
        }),
      });

      const data = await response.json();

      if (data.onboardingDraft) {
        window.localStorage.setItem(
          onboardingDraftStorageKey,
          JSON.stringify(data.onboardingDraft),
        );
      }

      if (!response.ok) {
        if (data.code === "already_onboarded" || data.alreadyOnboarded) {
          redirectToChatWithNotice(data.message || alreadyOnboardedMessage);
          return;
        }

        setStatus("error");
        setMessage(data.message ?? "建档失败，请检查输入后重试。");
        return;
      }

      window.localStorage.removeItem(onboardingDraftStorageKey);
      setStatus("success");
      setMessage(data.message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "未知错误";
      setStatus("error");
      setMessage(`建档请求失败：${reason}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isChecking) {
    return (
      <section className="mx-auto max-w-2xl rounded-lg border border-ink/10 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-ink">建档</h1>
        <p className="mt-3 text-sm text-ink/60">正在检查建档状态...</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl rounded-lg border border-ink/10 bg-white p-6 shadow-sm">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-ink">建档</h1>
        <p className="text-sm leading-6 text-ink/60">
          请输入基础信息，例如：昵称、性别、年龄、身高、体重、腰围、目标体重、训练频率。
        </p>
      </div>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <label className="block">
          <span className="text-sm font-medium text-ink">基础信息</span>
          <textarea
            rows={7}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={exampleInput}
            className="mt-2 w-full resize-none rounded-md border border-ink/15 px-3 py-3 text-sm leading-6 outline-none focus:border-moss"
          />
        </label>

        <button
          type="submit"
          disabled={isSubmitting || !userId || !input.trim()}
          className="rounded-md bg-moss px-5 py-3 text-sm font-medium text-white hover:bg-moss/90 disabled:cursor-not-allowed disabled:bg-ink/30"
        >
          {isSubmitting ? "提交中..." : "提交"}
        </button>
      </form>

      {message ? (
        <div
          className={`mt-5 rounded-md border px-4 py-3 text-sm leading-6 ${
            status === "success"
              ? "border-moss/30 bg-mint text-ink"
              : "border-clay/30 bg-clay/10 text-ink"
          }`}
        >
          {message}
        </div>
      ) : null}
    </section>
  );
}
