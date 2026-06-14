import type { MetadataRoute } from "next";

// PWA-манифест (ТЗ §11). Next отдаёт /manifest.webmanifest и сам линкует его.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NMNH Platform",
    short_name: "NMNH",
    description: "Персональные торговые сигналы под твой депозит. Реальный расчёт, риск под контролем.",
    lang: "ru",
    start_url: "/app/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0A0A1A",
    theme_color: "#0A0A1A",
    categories: ["finance", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
