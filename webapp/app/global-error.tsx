"use client";

// Упавшее приложение целиком.
//
// Сюда попадают поломки самого каркаса - те, после которых от страницы не
// остаётся ничего, включая разметку вокруг. Поэтому здесь свои `html` и `body`:
// корневой слой в этот момент уже не работает, и стили приходится подключать
// заново.
//
// Восстановить такую поломку перерисовкой раздела нельзя - только перезагрузкой
// страницы, её и предлагаем.

import "./globals.css";

import MaintenanceScreen, { MaintenanceAction } from "@/components/app/MaintenanceScreen";

export default function GlobalError() {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-black">
        <MaintenanceScreen
          title="Терминал не запустился"
          note="Перезагрузите страницу, обычно этого достаточно. Если не помогло, напишите нам, и мы починим."
          action={
            <MaintenanceAction onClick={() => window.location.reload()}>
              Перезагрузить
            </MaintenanceAction>
          }
        />
      </body>
    </html>
  );
}
