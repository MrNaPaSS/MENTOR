import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/pwa/ServiceWorkerRegister";
import InstallPrompt from "@/components/pwa/InstallPrompt";

export const metadata: Metadata = {
  metadataBase: new URL("https://nmnh.io"),
  title: {
    default: "NMNH — Персональные торговые сигналы",
    template: "%s — NMNH",
  },
  description:
    "Получай торговые сигналы под свой депозит. Реальный расчёт позиции, риск под контролем, закрытое сообщество учеников.",
  applicationName: "NMNH Platform",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "NMNH",
  },
  openGraph: {
    title: "NMNH — Персональные торговые сигналы",
    description:
      "Торгуй как профи. Учись у лучших. Персональные сигналы под твой депозит.",
    type: "website",
    locale: "ru_RU",
    siteName: "NMNH Platform",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = {
  themeColor: "#0A0A1A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
        <ServiceWorkerRegister />
        <InstallPrompt />
      </body>
    </html>
  );
}
