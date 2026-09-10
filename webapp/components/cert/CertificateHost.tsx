"use client";

// Сертификаты на уровне кабинета: спросить сервер, сказать о новом, открыть окно.
//
// Живёт в оболочке, а не в аналитике: сертификат выдаётся за торговлю, и узнать
// о нём трейдер должен там, где торгует. Уведомление - в общий склад
// (tradeAlerts), тем же золотым тоном, что награды, и по нажатию открывает окно.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Certificate, type CertificatesOut } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { dict } from "@/lib/i18n";
import {
  announceCertificates,
  CERT_OPEN_EVENT,
  CERT_UPDATED_EVENT,
  openCertificate,
} from "@/lib/certificates";
import { pushToast } from "@/lib/tradeAlerts";
import { play } from "@/lib/sound";
import CertificateDialog from "./CertificateDialog";

/** Не чаще раза в минуту: подсчёт столпов проходит по всему журналу. */
const MIN_INTERVAL_MS = 60_000;

export default function CertificateHost({ pathKey }: { pathKey: string }) {
  const [data, setData] = useState<CertificatesOut | null>(null);
  const [open, setOpen] = useState<Certificate | null>(null);
  const last = useRef(0);
  const told = useRef(new Set<number>());

  const load = useCallback((force = false) => {
    const token = getAccessToken();
    if (!token) return;
    const now = Date.now();
    if (!force && now - last.current < MIN_INTERVAL_MS) return;
    last.current = now;
    api
      .certificates(token)
      .then((body) => {
        setData(body);
        announceCertificates(body);
      })
      .catch(() => {});
  }, []);

  useEffect(() => load(), [load, pathKey]);

  // Новый, ещё не открытый сертификат - уведомление, один раз за вкладку.
  useEffect(() => {
    if (!data) return;
    const t = dict();
    for (const cert of data.certificates) {
      if (cert.seen || told.current.has(cert.id)) continue;
      told.current.add(cert.id);
      pushToast({
        id: `reward:cert:${cert.id}`,
        title: t.cert.toastTitle(t.cert.levels[cert.level]),
        text: t.cert.toastText,
        tone: "gold",
        action: () => openCertificate(cert.id),
      });
      play("reward");
    }
  }, [data]);

  // Снимок мог обновить другой (аналитика) - держим свой в согласии.
  useEffect(() => {
    const onUpdated = (e: Event) => {
      const body = (e as CustomEvent<CertificatesOut>).detail;
      if (body) setData(body);
    };
    window.addEventListener(CERT_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(CERT_UPDATED_EVENT, onUpdated);
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ id: number }>).detail?.id;
      const cert = data?.certificates.find((one) => one.id === id);
      if (!cert || !data) return;
      setOpen(cert);
      if (!cert.seen) {
        const token = getAccessToken();
        if (token) api.certificateSeen(token, cert.id).catch(() => {});
        const next = {
          ...data,
          certificates: data.certificates.map((one) => (one.id === cert.id ? { ...one, seen: true } : one)),
        };
        setData(next);
        announceCertificates(next);
      }
    };
    window.addEventListener(CERT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CERT_OPEN_EVENT, onOpen);
  }, [data]);

  if (!open || !data) return null;
  return <CertificateDialog cert={open} owner={data.owner} onClose={() => setOpen(null)} />;
}
