import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import ServiceWorkerRegister from "@/components/pwa/ServiceWorkerRegister";
import UiWatch from "@/components/log/UiWatch";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import DevBar from "@/components/dev/DevBar";
import TelegramInit from "@/components/telegram/TelegramInit";

export const metadata: Metadata = {
  metadataBase: new URL("https://nmnh.io"),
  title: {
    default: "NMNH - Профессиональный торговый терминал",
    template: "%s - NMNH",
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
    title: "NMNH - Профессиональный торговый терминал",
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
    // Тема по умолчанию отмечена сразу на сервере: без этого первый кадр
    // рисуется тёмным, а через мгновение перекрашивается в светлый. Свой выбор
    // трейдера перебивает скрипт темы при первом же рендере в браузере.
    <html lang="ru" data-terminal="light">
      <body className="min-h-screen bg-bg-deep font-sans text-text-primary antialiased">
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        <TelegramInit />
        {children}
        <ServiceWorkerRegister />
        <UiWatch />
        <InstallPrompt />
        <DevBar />
      </body>
    </html>
  );
}
