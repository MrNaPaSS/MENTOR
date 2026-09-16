"use client";

// Слой для окон: они живут в конце страницы, а не там, где их открыли.
//
// Разделы кабинета и терминала обёрнуты в `PaneScope`, а у неё `isolate` -
// своя стопка слоёв, чтобы горы шапки уходили под панели раздела. Побочное
// следствие: всё, что нарисовано внутри, остаётся внутри этой стопки, и окно
// с любым `z-index` не может подняться над шапкой сайта - затемнение накрывало
// раздел, а лента рынка и навигация оставались светлыми поверх него.
//
// Поэтому окно переносится в конец `body`: там оно в общей стопке страницы и
// честно накрывает всё. Цвета панелей приходится нести с собой - переменные
// `--pane-*` объявлены на классе темы, и снаружи `PaneScope` их нет.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useTerminalTheme } from "@/lib/terminalTheme";

export default function ModalPortal({ children }: { children: React.ReactNode }) {
  const theme = useTerminalTheme();
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const node = document.createElement("div");
    document.body.appendChild(node);
    setHost(node);
    return () => {
      node.remove();
    };
  }, []);

  // Первый кадр - без окна: на сервере `body` нет вовсе, и рисовать окно в
  // разметку страницы, чтобы следом перенести его, значит мигнуть им дважды.
  if (!host) return null;

  return createPortal(
    <div className={theme === "light" ? "pane-light" : "pane-dark"}>{children}</div>,
    host,
  );
}
