import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://nmnh.io"),
  title: {
    default: "NMNH — Персональные торговые сигналы",
    template: "%s — NMNH",
  },
  description:
    "Получай торговые сигналы под свой депозит. Реальный расчёт позиции, риск под контролем, закрытое сообщество учеников.",
  applicationName: "NMNH Platform",
  themeColor: "#0A0A1A",
  openGraph: {
    title: "NMNH — Персональные торговые сигналы",
    description:
      "Торгуй как профи. Учись у лучших. Персональные сигналы под твой депозит.",
    type: "website",
    locale: "ru_RU",
    siteName: "NMNH Platform",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-bg-deep font-sans text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
