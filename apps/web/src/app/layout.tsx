import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "fde-agent",
  description: "基于知识库检索的智能工单诊断",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="h-screen overflow-hidden antialiased">{children}</body>
    </html>
  );
}
