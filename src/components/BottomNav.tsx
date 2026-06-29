"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const hiddenRoutes = new Set(["/login"]);

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.75 11.25 12 5l7.25 6.25"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.25 10.5v8h9.5v-8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 18.5v-4h4v4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {active ? <circle cx="12" cy="21" r="1.25" fill="currentColor" /> : null}
    </svg>
  );
}

function UserIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.25" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M6.75 19c.7-2.75 2.55-4.25 5.25-4.25S16.55 16.25 17.25 19"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {active ? <circle cx="12" cy="21" r="1.25" fill="currentColor" /> : null}
    </svg>
  );
}

function BotIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="9" width="12" height="9" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M9 9V6.5a3 3 0 0 1 6 0V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M9.5 13h.01M14.5 13h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M10 16h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function NavItem({
  href,
  label,
  active,
  icon,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex min-w-[92px] flex-col items-center justify-center gap-1 rounded-[28px] px-5 py-3 text-[11px] font-semibold transition duration-200 ease-out hover:-translate-y-0.5 ${
        active ? "text-[#5f9b72]" : "text-ink/52"
      }`}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      <span className="leading-none">{label}</span>
    </Link>
  );
}

export function BottomNav() {
  const pathname = usePathname();

  if (hiddenRoutes.has(pathname)) {
    return null;
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[430px] px-4 pb-3">
      <div className="flex items-center justify-around rounded-t-[32px] rounded-b-[28px] bg-white/90 px-4 py-2 shadow-[0_-10px_34px_rgba(74,105,83,0.10),0_1px_0_rgba(255,255,255,0.95)_inset] backdrop-blur-xl">
        <NavItem
          href="/"
          label="首页"
          active={pathname === "/"}
          icon={<HomeIcon active={pathname === "/"} />}
        />
        <NavItem
          href="/dashboard"
          label="我的"
          active={pathname === "/dashboard"}
          icon={<UserIcon active={pathname === "/dashboard"} />}
        />
      </div>
      <Link
        href="/chat"
        aria-label="问问 AI"
        className="absolute bottom-[58px] right-6 flex h-14 w-14 items-center justify-center rounded-full bg-[#5f9b72] text-white shadow-[0_18px_34px_rgba(83,129,101,0.34)] transition duration-200 ease-out hover:-translate-y-1"
      >
        <BotIcon />
      </Link>
    </nav>
  );
}
