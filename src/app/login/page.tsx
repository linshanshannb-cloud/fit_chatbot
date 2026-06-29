"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const userIdStorageKey = "fat_loss_user_id";
const loginStorageKey = "fat_loss_logged_in";
const loginNameStorageKey = "fat_loss_login_name";
const chatNoticeStorageKey = "chat_notice";

function createUserId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `user_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const isLoggedIn = window.localStorage.getItem(loginStorageKey) === "true";
    const userId = window.localStorage.getItem(userIdStorageKey);

    if (!isLoggedIn || !userId) {
      return;
    }

    router.replace("/");
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    const nextUserId =
      window.localStorage.getItem(userIdStorageKey) ?? createUserId();

    window.localStorage.setItem(userIdStorageKey, nextUserId);
    window.localStorage.setItem(loginStorageKey, "true");
    window.localStorage.setItem(loginNameStorageKey, name.trim() || "用户");

    try {
      const response = await fetch(
        `/api/onboarding?userId=${encodeURIComponent(nextUserId)}`,
      );
      const data = await response.json();

      if (response.ok && data.exists) {
        router.replace("/");
        return;
      }

      window.sessionStorage.setItem(
        chatNoticeStorageKey,
        "欢迎回来。我们先完成基础建档吧，你可以直接告诉我：昵称、性别、年龄、身高、当前体重、腰围、目标体重和训练频率。",
      );
      router.replace("/chat");
    } catch {
      setMessage("登录已保存，但暂时无法检查建档状态。请稍后再试。");
      setIsSubmitting(false);
    }
  }

  return (
    <section className="min-h-screen bg-[#eee8dc] px-5 py-10 text-ink">
      <div className="pt-12">
        <p className="text-sm font-medium text-moss">AI 减脂陪伴</p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight">
          先进入你的健康空间
        </h1>
        <p className="mt-4 text-sm leading-6 text-ink/60">
          当前版本使用本地模拟登录，不接入真实账号系统。
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-10 rounded-[34px] bg-[#f7f3eb] p-6 shadow-[12px_12px_28px_rgba(174,164,146,0.36),-12px_-12px_28px_rgba(255,255,255,0.88)]"
      >
        <label className="block">
          <span className="text-sm font-medium text-ink/60">你的称呼</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：阿山"
            className="mt-3 w-full rounded-[22px] bg-[#eee8dc] px-4 py-4 text-base outline-none shadow-[inset_5px_5px_12px_rgba(174,164,146,0.25),inset_-5px_-5px_12px_rgba(255,255,255,0.72)] placeholder:text-ink/35"
          />
        </label>

        {message ? (
          <p className="mt-4 rounded-[20px] bg-[#fff6e8] px-4 py-3 text-sm leading-6 text-ink/70">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-6 w-full rounded-[24px] bg-moss px-5 py-4 text-sm font-semibold text-white shadow-[8px_8px_18px_rgba(80,117,104,0.28),-6px_-6px_16px_rgba(255,255,255,0.72)] disabled:cursor-not-allowed disabled:bg-ink/30"
        >
          {isSubmitting ? "正在进入..." : "进入 App"}
        </button>
      </form>
    </section>
  );
}
