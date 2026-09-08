"use client";

// Включатель журнала действий. Висит в корне сайта и не рисует ничего.
//
// Отдельным компонентом, а не строкой в разметке: слушатели надо снимать при
// уходе, а переходы между разделами - записывать, и то и другое требует
// жизненного цикла.

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { record, watchUi } from "@/lib/log";

export default function UiWatch() {
  useEffect(() => watchUi(), []);

  const path = usePathname();
  useEffect(() => {
    // Куда человек перешёл. Первая запись после загрузки страницы говорит ещё и
    // о том, что вкладку перезагрузили, - по журналу это иначе не отличить от
    // обычного перехода.
    record("ui.route", { path });
  }, [path]);

  return null;
}
