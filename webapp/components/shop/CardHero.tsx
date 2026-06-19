"use client";

import { useState, useEffect } from "react";
import ShopIcon from "./ShopIcon";

/**
 * Обложка карточки товара. Если картинка не загрузилась (битая ссылка) —
 * плавно откатывается на градиентный фон с крупной иконкой, без «битой картинки».
 */
export default function CardHero({
  image, icon, accent, children,
}: {
  image: string | null;
  icon: string;
  accent: "gold" | "cyan";
  children?: React.ReactNode;
}) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [image]);

  const ok = image && !err;
  const grad = accent === "gold"
    ? "from-accent-gold/[0.16] via-bg-card/30 to-transparent"
    : "from-accent-cyan/[0.14] via-bg-card/30 to-transparent";
  const radial = accent === "gold"
    ? "bg-[radial-gradient(circle_at_50%_35%,rgba(255,200,0,0.18),transparent_62%)]"
    : "bg-[radial-gradient(circle_at_50%_35%,rgba(10,255,224,0.16),transparent_62%)]";
  const iconColor = accent === "gold" ? "text-accent-gold/80" : "text-accent-cyan/80";

  return (
    <div className="relative h-40 overflow-hidden">
      {ok ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image!}
            alt=""
            onError={() => setErr(true)}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-bg-card via-bg-card/10 to-transparent" />
        </>
      ) : (
        <div className={`relative flex h-full w-full items-center justify-center bg-gradient-to-br ${grad}`}>
          <div className={`absolute inset-0 ${radial}`} />
          <ShopIcon name={icon} className={`h-12 w-12 ${iconColor}`} />
        </div>
      )}
      {children}
    </div>
  );
}
