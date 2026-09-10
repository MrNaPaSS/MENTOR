"use client";

// Сертификаты трейдера в кабинете: общий снимок, события и подписи.
//
// Снимок один на вкладку: его показывают и шапка (уведомление о новом
// сертификате), и аналитика (блок с уровнями). Каждый спрашивает сервер сам,
// но не чаще раза в минуту - подсчёт столпов проходит по всему журналу.

import type { Certificate, CertificatesOut, CertPillar } from "./api";
import type { Dict } from "./i18n";
import type { CertData, CertLevel } from "./cert/render";

/** Открыть окно сертификата. detail: { id }. */
export const CERT_OPEN_EVENT = "nmnh-certificate-open";
/** Снимок сертификатов обновился. detail: CertificatesOut. */
export const CERT_UPDATED_EVENT = "nmnh-certificates-updated";

export function openCertificate(id: number): void {
  window.dispatchEvent(new CustomEvent(CERT_OPEN_EVENT, { detail: { id } }));
}

export function announceCertificates(data: CertificatesOut): void {
  window.dispatchEvent(new CustomEvent(CERT_UPDATED_EVENT, { detail: data }));
}

/** Что написать под подписью столпа на бланке. */
export function pillarValue(pillar: CertPillar, t: Dict): string {
  const c = t.cert.onCard;
  switch (pillar.key) {
    case "knowledge":
      return pillar.done ? c.knowledgeDone : c.knowledgeNo;
    case "practice":
      return c.practice(pillar.value);
    case "discipline":
      return c.discipline(pillar.value);
    case "growth":
      return pillar.done ? c.growthDone : c.growthNo;
  }
}

/** Всё, что нужно холсту, чтобы собрать бланк этого сертификата. */
export function certData(cert: Certificate, owner: string, t: Dict, locale: string): CertData {
  const level = cert.level as CertLevel;
  const done = cert.pillars.filter((p) => p.done).length;
  const levelName = t.cert.levels[level];
  return {
    owner,
    level,
    pillars: cert.pillars,
    labels: {
      level: levelName,
      levelLine: t.cert.levelLine(levelName, done),
      pillarValues: cert.pillars.map((p) => pillarValue(p, t)),
      date: new Date(cert.issued_at).toLocaleDateString(locale, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      number: t.cert.number(cert.number),
    },
  };
}
