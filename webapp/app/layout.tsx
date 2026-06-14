import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NMNH — Персональные торговые сигналы",
  description:
    "Получай сигналы под свой депозит. Реальный расчёт. Реальный результат.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-bg-deep text-text-primary font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
