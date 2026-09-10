import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Шрифты берём сборкой, а не у Google из браузера.
 *
 * Раньше в начале globals.css стоял `@import` с fonts.googleapis.com, и до
 * первой буквы правильным шрифтом браузер шёл тремя кругами: скачать наш CSS,
 * прочитать в нём импорт, сходить к Google за вторым CSS и только потом - к
 * gstatic за самим шрифтом. Всё это на критическом пути каждой страницы, а у
 * части людей Google ещё и отвечает через раз.
 *
 * Теперь файлы шрифта лежат у нас и приезжают с той же раздачей, что и
 * страница: ни одного чужого запроса, ни одного лишнего круга.
 *
 * Кириллица в наборе обязательна: сайт русский, и без неё браузер подставил бы
 * под русский текст первый попавшийся системный шрифт.
 */
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-inter",
});

const mono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-jetbrains",
});
import ServiceWorkerRegister from "@/components/pwa/ServiceWorkerRegister";
import UiWatch from "@/components/log/UiWatch";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import DevBar from "@/components/dev/DevBar";
import TelegramInit from "@/components/telegram/TelegramInit";
import ServerUpdating from "@/components/app/ServerUpdating";

/**
 * Адрес, от которого считаются полные ссылки в метаданных.
 *
 * Здесь была причина того, что предпросмотр ссылки приходил без картинки:
 * основой стоял nmnh.io, а сайт живёт на www.nmnh.trade - и og:image указывал
 * на чужой домен, где этой картинки нет. Telegram сходил по адресу, ничего не
 * нашёл и показал одни слова.
 *
 * Из окружения, если задано: у ветки для проверки свой адрес, и картинку она
 * должна отдавать со своего.
 */
const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://www.nmnh.trade";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "NMNH - Профессиональный торговый терминал",
    template: "%s - NMNH",
  },
  description:
    "Терминал с софтом под твою биржу, живой чат трейдеров, журнал сделок с аналитикой и активностями и внутренний токен - в одной экосистеме.",
  applicationName: "NMNH Platform",
  manifest: "/manifest.webmanifest",
  // Метка версии в адресах значков - не украшение. Браузер держит значок
  // вкладки едва ли не дольше всего остального и по одному адресу отдаёт
  // прежнюю картинку неделями; со сменой метки он идёт за новой.
  icons: {
    icon: [
      { url: "/favicon-32.png?v=6", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png?v=6", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png?v=6",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "NMNH",
  },
  openGraph: {
    title: "NMNH - Профессиональный торговый терминал",
    description:
      "Терминал с софтом под твою биржу, живой чат трейдеров, журнал сделок с аналитикой и активностями и внутренний токен - в одной экосистеме.",
    type: "website",
    locale: "ru_RU",
    siteName: "NMNH Platform",
    url: SITE,
    // Метка версии - по той же причине, что у значка вкладки: превью
    // кэшируют все, кому его однажды отдали, и старую картинку они держат
    // неделями.
    //
    // JPEG, а не PNG: на баннере фотография, и в PNG она весит под мегабайт
    // против ста семидесяти килобайт - за превью, которое разворачивается на
    // телефоне, платить мегабайтом незачем.
    images: [{ url: "/og.jpg?v=4", width: 1200, height: 630, type: "image/jpeg" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.jpg?v=4"] },
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
    <html lang="ru" data-terminal="light" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-bg-deep font-sans text-text-primary antialiased">
        {/* Телеграмовский скрипт больше не стоит перед страницей.
            Он нужен одному входу из нескольких - тем, кто открыл кабинет
            внутри Telegram, - а грузился у всех и до отрисовки: пока чужой
            сервер молчал, у человека молчал и сайт. Теперь он приезжает после
            того, как страница ожила, а то, что его ждёт, умеет подождать. */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
        <TelegramInit />
        {children}
        <ServerUpdating />
        <ServiceWorkerRegister />
        <UiWatch />
        <InstallPrompt />
        <DevBar />
      </body>
    </html>
  );
}
