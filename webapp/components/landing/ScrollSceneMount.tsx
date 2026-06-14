"use client";

import dynamic from "next/dynamic";

// Грузим WebGL-сцену только на клиенте (без SSR).
const ScrollScene = dynamic(() => import("./ScrollScene"), { ssr: false });

/** Фиксированный объёмный фон лендинга позади контента. */
export default function ScrollSceneMount() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
      <ScrollScene />
      {/* Виньетка: затемняет края, чтобы контент оставался читаемым */}
      <div className="absolute inset-0 bg-gradient-to-b from-bg-deep/50 via-bg-deep/10 to-bg-deep/85" />
    </div>
  );
}
