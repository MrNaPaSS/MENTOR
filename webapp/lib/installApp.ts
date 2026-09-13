"use client";

// Установка кабинета на рабочий стол.
//
// Браузер решает сам, показывать ли своё предложение установить сайт, и делает
// это когда захочет - у одного оно всплывает на второй день, у другого не
// всплывает вовсе. Человеку при этом нужна одна кнопка в понятном месте.
//
// Поэтому предложение перехватывается и придерживается: браузер сообщает о
// готовности событием, мы его останавливаем и держим у себя, а показываем
// тогда, когда трейдер сам нажмёт «установить».
//
// Отдельно от кнопки намеренно: событие приходит один раз на всю жизнь
// вкладки, часто до того, как человек дойдёт до профиля, и ловить его должен
// не тот, кто рисует.

import { useEffect, useState } from "react";

/** Что браузер присылает перед своим предложением установки. */
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Придержанное предложение.
 *
 * Живёт в модуле, а не в состоянии: событие приходит один раз, задолго до
 * того, как откроется профиль, и компонент, смонтированный после него, узнать
 * о нём иначе не может.
 */
let held: InstallPrompt | null = null;

// Ловушка включается при загрузке этого модуля, и грузится он вместе с
// баннером установки (`components/pwa/InstallPrompt`), то есть с корневым
// макетом - раньше, чем браузер успеет прислать своё предложение.
//
// Раньше модуль приезжал только со страницей профиля, то есть почти всегда
// позже события: кнопка «Установить» в настройках отвечала подсказкой
// поставить руками через меню браузера, хотя браузер был готов поставить сам.

/** Кому сказать, что предложение появилось или было израсходовано. */
const watchers = new Set<(ready: boolean) => void>();

function tell(): void {
  for (const watcher of watchers) watcher(held !== null);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Останавливаем своё предложение браузера: показать его должны мы, из
    // профиля, а не он сам поверх графика в середине сделки.
    event.preventDefault();
    held = event as InstallPrompt;
    tell();
  });
  window.addEventListener("appinstalled", () => {
    held = null;
    tell();
  });
}

/**
 * Кабинет уже стоит на этом устройстве, хотя открыт сейчас во вкладке.
 *
 * Это вторая половина ответа на вопрос «почему кнопка не работает». Браузер
 * присылает предложение установки ровно один раз и только тому, у кого
 * приложения ещё нет: поставил человек кабинет раньше - и во вкладке кнопка
 * висит, а нажатие ничего не делает, потому что предлагать нечего.
 *
 * Спрашиваем у браузера напрямую. Умеют это не все (Safari и Firefox о таком
 * не знают), поэтому ответ «нет» означает «не знаем», а не «не установлено».
 */
export async function installedNearby(): Promise<boolean> {
  const ask = (
    navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<unknown[]>;
    }
  ).getInstalledRelatedApps;
  if (typeof ask !== "function") return false;
  try {
    const apps = await ask.call(navigator);
    return apps.length > 0;
  } catch {
    return false;
  }
}

/** Кабинет уже открыт как приложение: устанавливать нечего. */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // Safari на iOS о display-mode не знает и отвечает своим полем.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/**
 * Показать предложение установки.
 *
 * Возвращает, согласился ли человек. Предложение одноразовое: браузер второй
 * раз то же самое не покажет, поэтому после ответа мы его отпускаем.
 */
export async function installApp(): Promise<boolean> {
  const prompt = held;
  if (!prompt) return false;
  held = null;
  tell();
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome === "accepted";
}

/**
 * Можно ли сейчас предложить установку.
 *
 * Первое значение всегда `false` - и на сервере, где окна нет, и в первом
 * кадре браузера: разметка, собранная на сервере, обязана совпасть с первой
 * отрисовкой, иначе React ругается на расхождение.
 */
export function useCanInstall(): boolean {
  const [can, setCan] = useState(false);

  useEffect(() => {
    const watcher = (ready: boolean) => setCan(ready && !isInstalled());
    watchers.add(watcher);
    watcher(held !== null);
    return () => {
      watchers.delete(watcher);
    };
  }, []);

  return can;
}
