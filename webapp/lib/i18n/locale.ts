"use client";

// Язык интерфейса за пределами страницы, где его переключают.
//
// Переключатель живёт в профиле, а надписи - в шапке, на лендинге, в
// терминале и в модулях, которые вообще не часть дерева React (звук, журнал,
// карточка сделки). Значит язык обязан жить снаружи от всех них - в одном
// месте, как это уже сделано для темы терминала.
//
// Выбор хранится и на сервере (`Profile.language`), и локально. Сервер - чтобы
// язык переехал вместе с человеком на другое устройство, локально - чтобы
// первый кадр рисовался сразу на нужном языке, не дожидаясь ответа профиля.

import { useEffect, useState } from "react";

export type Locale = "ru" | "en";

const KEY = "nmnh.locale";
const EVENT = "nmnh-locale";

/** Язык, с которым сайт открывается впервые. */
const DEFAULT: Locale = "ru";

function normalize(value: unknown): Locale | null {
  return value === "ru" || value === "en" ? value : null;
}

export function readLocale(): Locale {
  try {
    return normalize(localStorage.getItem(KEY)) ?? DEFAULT;
  } catch {
    // В приватном окне доступ к хранилищу бросает исключение.
    return DEFAULT;
  }
}

/**
 * Запомнить язык, отметить его на корне документа и сказать всем слушателям.
 *
 * `<html lang>` - не украшение: по нему браузер выбирает переносы и словарь
 * проверки орфографии, а экранный диктор - голос.
 */
export function setLocale(locale: Locale): void {
  try {
    document.documentElement.lang = locale;
  } catch {
    // На сервере документа нет - язык применится при первом рендере в браузере.
  }
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    // Не сохранилось - в этой вкладке язык всё равно применится.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: locale }));
}

/**
 * Принять язык, пришедший с сервером вместе с профилем.
 *
 * Сервер главнее локального хранилища: человек мог переключить язык на
 * телефоне, а сюда зайти с ноутбука, где выбора ещё не делали. Но переписывать
 * хранилище на каждый ответ профиля нельзя - иначе щелчок по переключателю
 * откатывался бы назад, пока запрос PATCH ещё в пути.
 */
export function adoptLocale(value: string | null | undefined): void {
  const next = normalize(value);
  if (!next || next === readLocale()) return;
  setLocale(next);
}

/**
 * Язык интерфейса с подпиской на его смену.
 *
 * Слушаем и своё событие, и storage: во второй вкладке язык тоже могли
 * переключить, и эта не должна остаться на прежнем.
 */
export function useLocale(): Locale {
  // До первого чтения хранилища держим тот же язык, что и разметка с сервера:
  // иначе первый кадр в браузере разошёлся бы с уже нарисованным.
  const [locale, setState] = useState<Locale>(DEFAULT);

  useEffect(() => {
    const saved = readLocale();
    setState(saved);
    document.documentElement.lang = saved;

    function onLocal(event: Event) {
      const next = normalize((event as CustomEvent<Locale>).detail) ?? DEFAULT;
      setState(next);
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== KEY) return;
      const next = readLocale();
      setState(next);
      document.documentElement.lang = next;
    }

    window.addEventListener(EVENT, onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return locale;
}
