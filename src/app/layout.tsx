import type { Metadata } from "next";
import { BottomNav } from "@/components/BottomNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 减脂陪伴",
  description: "移动端优先的 AI 减脂陪伴 Web App",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#eaf4e9] font-sans text-ink antialiased">
        <main className="mx-auto min-h-screen w-full max-w-[430px] bg-[#eaf4e9] pb-28">
          {children}
        </main>
        <BottomNav />
      </body>
    </html>
  );
}
