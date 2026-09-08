"use client";

// Звук событий: настройка человека, а не одной страницы.
//
// Раньше он жил внутри рабочего места терминала - в общем свёртке настроек
// панелей. Там ему не место: выключить звук хочется из профиля, где собраны
// остальные настройки, а рабочее место - про ширину панелей и набор
// индикаторов. Две записи об одном и том же неизбежно разошлись бы.
//
// Устроено так же, как тема терминала: значение живёт снаружи React, страницы
// на него подписываются. Слушаем и своё событие, и storage - во второй вкладке
// звук могли выключить, и первая не должна остаться при своём.

import { useEffect, useState } from "react";

import { setMuted } from "./sound";

const KEY = "nmnh.sound";
const EVENT = "nmnh-sound";

/** Звук по умолчанию включён: сигнал о взятой цели важнее тишины. */
const DEFAULT = true;

/** Старое место: свёрток настроек терминала. Читаем ради тех, кто уже выбрал. */
const LEGACY_KEY = "nmnh.scalping.panes";

const listeners = new Set<() => void>();

function read(): boolean {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "on") return true;
    if (saved === "off") return false;

    // Своего ключа ещё нет - смотрим в рабочее место. Человек однажды выключил
    // звук, и переезд настройки не повод включить его снова.
    const panes = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
    if (panes && typeof panes.sound === "boolean") return panes.sound;
  } catch {
    // В приватном окне доступ к хранилищу бросает исключение.
  }
  return DEFAULT;
}

/** Играет ли звук прямо сейчас. */
export function soundOn(): boolean {
  return read();
}

/**
 * Включить или выключить звук.
 *
 * Заодно говорит об этом самому проигрывателю: он держит своё состояние и без
 * этого продолжил бы звучать до перезагрузки страницы.
 */
export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Не сохранилось - в этой вкладке настройка всё равно применится.
  }
  setMuted(!on);
  for (const fn of listeners) fn();
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // На сервере окна нет.
  }
}

/** Состояние звука с подпиской на его смену. */
export function useSoundOn(): boolean {
  // До первого чтения хранилища держим значение по умолчанию: иначе на
  // мгновение показалась бы чужая настройка.
  const [on, setOn] = useState(DEFAULT);

  useEffect(() => {
    function sync() {
      const value = read();
      setOn(value);
      setMuted(!value);
    }
    sync();

    function onStorage(event: StorageEvent) {
      if (event.key === KEY || event.key === LEGACY_KEY) sync();
    }
    listeners.add(sync);
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(sync);
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return on;
}
