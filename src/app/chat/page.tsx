"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ChatMessage = {
  id?: string;
  role: "assistant" | "user";
  content: string;
  created_at?: string;
};

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
const loginStorageKey = "fat_loss_logged_in";
const chatNoticeStorageKey = "chat_notice";
const onboardingDraftStorageKey = "onboarding_draft";
const dashboardCacheKey = "dashboard_cache";

const welcomeMessage: ChatMessage = {
  role: "assistant",
  content:
    "你好，我会陪你记录减脂过程。你可以告诉我今天的体重、腰围、体脂，也可以直接聊饮食和训练。",
};

function BotIcon() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#d8ecd9] text-[#5f9b72] shadow-[0_10px_22px_rgba(83,129,101,0.12)]">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="6" y="9" width="12" height="9" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M9 9V6.5a3 3 0 0 1 6 0V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M9.5 13h.01M14.5 13h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M10 16h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function SparkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5 13.8 9l5.7 1.9-5.7 1.9L12 18.5l-1.8-5.7-5.7-1.9L10.2 9 12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M19 3v3M20.5 4.5h-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [nickname, setNickname] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  function readOnboardingDraft() {
    const rawDraft = window.localStorage.getItem(onboardingDraftStorageKey);

    if (!rawDraft) return null;

    try {
      return JSON.parse(rawDraft) as OnboardingDraft;
    } catch {
      window.localStorage.removeItem(onboardingDraftStorageKey);
      return null;
    }
  }

  function readNicknameFromCache(nextUserId: string) {
    const rawCache = window.localStorage.getItem(dashboardCacheKey);

    if (!rawCache) return "";

    try {
      const cache = JSON.parse(rawCache) as {
        user_id?: string;
        user_info?: { nickname?: string | null };
      };

      if (cache.user_id && cache.user_id !== nextUserId) return "";

      return cache.user_info?.nickname?.trim() ?? "";
    } catch {
      return "";
    }
  }

  useEffect(() => {
    async function loadHistory() {
      const isLoggedIn = window.localStorage.getItem(loginStorageKey) === "true";
      const nextUserId = window.localStorage.getItem(userIdStorageKey);

      if (!isLoggedIn || !nextUserId) {
        router.replace("/login");
        return;
      }

      setUserId(nextUserId);
      setNickname(readNicknameFromCache(nextUserId));

      const notice = window.sessionStorage.getItem(chatNoticeStorageKey);

      if (notice) {
        window.sessionStorage.removeItem(chatNoticeStorageKey);
      }

      try {
        const response = await fetch(
          `/api/chat/history?userId=${encodeURIComponent(nextUserId)}&limit=30`,
        );
        const data = await response.json();
        const history = (data.messages ?? []) as ChatMessage[];
        const nextMessages = history.length > 0 ? history : [welcomeMessage];

        setMessages(
          notice
            ? [...nextMessages, { role: "assistant", content: notice }]
            : nextMessages,
        );
      } catch {
        setMessages(
          notice
            ? [welcomeMessage, { role: "assistant", content: notice }]
            : [welcomeMessage],
        );
      } finally {
        setIsLoadingHistory(false);
      }
    }

    loadHistory();
  }, [router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoadingHistory]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedInput = input.trim();

    if (!trimmedInput || isSending) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: trimmedInput,
    };

    setMessages((currentMessages) => [...currentMessages, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmedInput,
          userId,
          onboardingDraft: readOnboardingDraft(),
        }),
      });

      const data = await response.json();

      if (data.type === "onboarding_completed") {
        window.localStorage.removeItem(onboardingDraftStorageKey);
      } else if (data.type === "onboarding" && data.onboardingDraft) {
        window.localStorage.setItem(
          onboardingDraftStorageKey,
          JSON.stringify(data.onboardingDraft),
        );
      }

      const reply =
        typeof data.message === "string"
          ? data.message
          : "我暂时没能处理这条消息，请稍后再试。";

      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "assistant", content: reply },
      ]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "未知错误";
      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "assistant", content: `聊天请求失败：${reason}` },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  const hasInput = input.trim().length > 0;

  return (
    <section className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_-8%,#f4fbf2_0%,#dfeee0_48%,#d8e9d8_100%)] px-4 pb-3 pt-4 text-ink">
      <div className="shrink-0">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/76 text-xl font-semibold text-ink/70 shadow-[0_10px_24px_rgba(55,86,68,0.10),0_1px_0_rgba(255,255,255,0.95)_inset] transition duration-200 hover:-translate-x-0.5 hover:bg-white"
          aria-label="返回首页"
        >
          ←
        </button>

        <div className="max-h-[22vh] rounded-[30px] bg-white/88 px-5 py-4 shadow-[0_18px_42px_rgba(55,86,68,0.13),0_2px_0_rgba(255,255,255,0.96)_inset]">
          <div className="flex items-center gap-2 text-[#5f9b72]">
            <SparkIcon />
            <span className="text-sm font-black tracking-tight">问问 AI</span>
          </div>
          <h1 className="mt-2 text-2xl font-black leading-tight tracking-[-0.03em] text-ink">
            和你一起慢慢变好
          </h1>
          <p className="mt-2 text-sm font-medium leading-6 text-ink/58">
            记录体重、训练和饮食，也陪你处理减脂路上的小波动。
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-1 pb-4 pt-5">
        {isLoadingHistory ? (
          <div className="flex items-start gap-3">
            <BotIcon />
            <div className="max-w-[82%] rounded-[28px] bg-white/90 px-5 py-4 text-base leading-7 text-ink/62 shadow-[0_16px_34px_rgba(55,86,68,0.11),0_1px_0_rgba(255,255,255,0.96)_inset]">
              正在加载聊天记录...
            </div>
          </div>
        ) : (
          messages.map((message, index) =>
            message.role === "user" ? (
              <div key={message.id ?? `${message.role}-${index}`} className="flex justify-end">
                <div className="max-w-[78%] break-words whitespace-pre-wrap rounded-[26px] bg-[#5f9b72] px-5 py-3.5 text-base font-medium leading-7 text-white shadow-[0_14px_28px_rgba(74,132,88,0.24)]">
                  {message.content}
                </div>
              </div>
            ) : (
              <div key={message.id ?? `${message.role}-${index}`} className="flex items-start gap-3">
                <BotIcon />
                <div className="max-w-[82%] break-words whitespace-pre-wrap rounded-[30px] bg-white/90 px-5 py-4 text-base font-medium leading-8 text-ink/86 shadow-[0_16px_34px_rgba(55,86,68,0.11),0_1px_0_rgba(255,255,255,0.96)_inset]">
                  {message.content}
                </div>
              </div>
            ),
          )
        )}

        {isSending ? (
          <div className="flex items-start gap-3">
            <BotIcon />
            <div className="rounded-[28px] bg-white/90 px-5 py-4 text-base leading-7 text-ink/62 shadow-[0_16px_34px_rgba(55,86,68,0.11),0_1px_0_rgba(255,255,255,0.96)_inset]">
              正在分析...
            </div>
          </div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      <form
        ref={formRef}
        className="shrink-0"
        onSubmit={handleSubmit}
      >
        <div className="flex min-h-[68px] items-end rounded-[32px] bg-white/86 px-5 py-3 shadow-[0_18px_42px_rgba(55,86,68,0.17),0_1px_0_rgba(255,255,255,0.96)_inset] backdrop-blur-xl">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            placeholder={`${nickname || "我"}今天的体重是...`}
            rows={1}
            className="max-h-28 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-lg leading-7 text-ink outline-none placeholder:text-ink/42"
          />
          <button
            type="submit"
            disabled={isSending || isLoadingHistory || !hasInput}
            className={`mb-0.5 ml-3 flex h-13 w-13 shrink-0 items-center justify-center rounded-full p-3 text-white transition duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed ${
              hasInput
                ? "bg-[#5f9b72] shadow-[0_14px_28px_rgba(83,129,101,0.30)]"
                : "bg-[#b8d8bd] shadow-[0_12px_24px_rgba(83,129,101,0.18)] disabled:bg-[#c8d8c9] disabled:shadow-none"
            }`}
            aria-label="发送"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 19V5M6.5 10.5 12 5l5.5 5.5"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </form>
    </section>
  );
}
