"use client";

// Окно сертификата трейдера.
//
// Лист появляется сразу, без «принтера» карточки сделки: сертификат не
// печатают, его подписывают. Двигаются только две вещи - подпись ведётся
// ручкой по своей линии, и следом между датой и подписью падает печать.
//
// Подпись - это картинка, проявляемая маской: по линии середины штриха
// (lib/cert/signaturePath.ts) идёт толстая линия маски, и где она прошла,
// подпись видна. Когда ручка дошла до конца, маска снимается - на месте
// оказывается и то, что линия не покрыла (точка в конце росчерка).
//
// В буфер и файлом уходит картинка холста: там подпись и печать уже стоят.

import { useCallback, useEffect, useId, useState } from "react";
import { Copy, Download, X } from "lucide-react";
import type { Certificate } from "@/lib/api";
import { useIntlLocale, useT } from "@/lib/i18n";
import { certData } from "@/lib/certificates";
import { CERT_H, CERT_W, renderCert, SIGNATURE_SRC, SPOTS, stampSrc, type CertLevel } from "@/lib/cert/render";
import { SIGNATURE } from "@/lib/cert/signaturePath";
import { copy, download } from "@/lib/pnl/share";

const pct = (value: number, of: number) => `${(value / of) * 100}%`;

export default function CertificateDialog({
  cert,
  owner,
  onClose,
}: {
  cert: Certificate;
  owner: string;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useIntlLocale();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [sheet, setSheet] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [signed, setSigned] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const data = certData(cert, owner, t, locale);
  const level = cert.level as CertLevel;

  useEffect(() => {
    let dropped = false;
    renderCert(data, false)
      .then((canvas) => {
        if (!dropped) setSheet(canvas.toDataURL("image/jpeg", 0.92));
      })
      .catch(() => {
        if (!dropped) setFailed(true);
      });
    return () => {
      dropped = true;
    };
    // Данные сертификата не меняются, пока окно открыто.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cert.id, owner, locale]);

  // Без движения в системе ручка не пишет: подпись сразу целиком.
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setSigned(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const finished = useCallback(() => renderCert(data, true), [data]);

  function onCopy() {
    copy(finished()).then((ok) => setNote(ok ? t.cert.copied : t.cert.copyFailed));
  }

  async function onDownload() {
    await download(await finished(), `nmnh-certificate-${cert.number}`);
    setNote(t.cert.saved);
  }

  const sig = SPOTS.signature;
  const stamp = SPOTS.stamp;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="my-auto flex w-full max-w-[820px] flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[12px] uppercase tracking-widest text-white/60">
            {t.cert.dialogTitle(t.cert.levels[level])}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.cert.close}
            className="rounded p-1 text-white/60 transition-colors duration-150 ease-out hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {sheet ? (
          <div className="cert-sheet relative overflow-hidden rounded-lg shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sheet} alt={t.cert.alt(owner)} className="block h-auto w-full" />

            <svg
              aria-hidden
              viewBox={`0 0 ${SIGNATURE.width} ${SIGNATURE.height}`}
              className="absolute"
              style={{
                left: pct(sig.x, CERT_W),
                top: pct(sig.y, CERT_H),
                width: pct(sig.w, CERT_W),
                height: pct(sig.h, CERT_H),
              }}
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <mask id={`${uid}pen`} maskUnits="userSpaceOnUse">
                  <path
                    d={SIGNATURE.d}
                    pathLength={1}
                    className="cert-pen"
                    fill="none"
                    stroke="white"
                    strokeWidth={SIGNATURE.pen * 1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    onAnimationEnd={() => setSigned(true)}
                  />
                </mask>
              </defs>
              <image
                href={SIGNATURE_SRC}
                width={SIGNATURE.width}
                height={SIGNATURE.height}
                mask={signed ? undefined : `url(#${uid}pen)`}
              />
            </svg>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={stampSrc(level)}
              alt=""
              aria-hidden
              className="cert-stamp absolute"
              style={{
                left: pct(stamp.x - stamp.size / 2, CERT_W),
                top: pct(stamp.y - stamp.size / 2, CERT_H),
                width: pct(stamp.size, CERT_W),
              }}
            />
          </div>
        ) : (
          <div className="grid aspect-[1491/1055] place-items-center rounded-lg border border-white/10 bg-white/5 text-[12px] text-white/60">
            {failed ? t.cert.failed : t.cert.assembling}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-white/60">{note ?? t.cert.number(cert.number)}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCopy}
              disabled={!sheet}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-[12px] font-semibold text-white/85 transition-[background-color,transform] duration-150 ease-out hover:bg-white/10 active:scale-[0.97] disabled:opacity-40"
            >
              <Copy className="h-3.5 w-3.5" />
              {t.cert.copy}
            </button>
            <button
              type="button"
              onClick={onDownload}
              disabled={!sheet}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-bold text-black transition-[opacity,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-40"
              style={{ background: "#e8c35a" }}
            >
              <Download className="h-3.5 w-3.5" />
              {t.cert.download}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
