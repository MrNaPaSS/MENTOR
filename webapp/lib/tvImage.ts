// Превью-картинки: тот же механизм, что в «Анализах»/рассылке.
// TradingView snapshot-ссылка (tradingview.com/x/{ID}) напрямую отдаёт PNG
// по предсказуемому URL на s3 — это и есть «предпросмотр как в телеграм».
// Страницы скриптов/индикаторов (/script/...) такого снапшота НЕ имеют.

import { API_URL } from "./api";

/** Превратить TradingView snapshot-ссылку или /uploads-путь в URL картинки. */
export function tvSnapshot(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/uploads/")) return `${API_URL}${url}`;
  const m = url.match(/tradingview\.com\/x\/([A-Za-z0-9]+)/);
  if (m) return `https://s3.tradingview.com/snapshots/${m[1][0].toLowerCase()}/${m[1]}.png`;
  return null;
}

/**
 * Картинка для карточки товара: явный image_url имеет приоритет,
 * иначе пробуем вывести превью из ссылки-снапшота TradingView.
 */
export function cardImage(imageUrl?: string | null, linkUrl?: string | null): string | null {
  if (imageUrl) {
    return imageUrl.startsWith("/uploads/") ? `${API_URL}${imageUrl}` : imageUrl;
  }
  return tvSnapshot(linkUrl);
}
