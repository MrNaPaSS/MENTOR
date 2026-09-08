"use client";

// Упавший раздел.
//
// Next показывает здесь свой экран с текстом ошибки и кнопкой - экран
// разработчика: человеку, который пришёл смотреть график, слово «Error» и
// цифровой код не говорят ничего, кроме «сломано насовсем». Заслонка на его
// месте говорит то же, что и при выключенном сервере: место живое, попробуйте
// ещё раз.
//
// Раздел падает, а приложение остаётся: `reset` перерисовывает только его. Это
// и предлагаем первым действием - оно чаще всего и помогает.

import MaintenanceScreen, { MaintenanceAction } from "@/components/app/MaintenanceScreen";

export default function SectionError({ reset }: { error: Error; reset: () => void }) {
  return (
    <MaintenanceScreen
      title="Раздел не открылся"
      note="Мы уже знаем об этом. Попробуйте открыть его снова — остальной терминал работает."
      action={<MaintenanceAction onClick={reset}>Попробовать снова</MaintenanceAction>}
    />
  );
}
