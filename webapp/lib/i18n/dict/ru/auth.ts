// Вход в кабинет: пароль от бота академии и запасной путь по WEEX UID.

export const auth = {
  title: "Вход в NMNH Platform",
  subtitleTg: "Пароль выдаёт бот академии",
  subtitleUid: "Авторизация по WEEX UID",
  subtitleCode: "Подтверди вход кодом из Telegram",

  steps: [
    "1. Откройте бота академии и нажмите «Войти на сайт».",
    "2. Бот проверит счёт и пришлёт пароль на пять минут.",
    "3. Введите его здесь.",
  ],
  openBot: "Открыть бота академии",
  passLabel: "Пароль из бота",
  passHint: "Черту и регистр можно не соблюдать.",
  passFailed: "Пароль не подошёл",

  uidLabel: "Ваш WEEX UID",
  uidHint: "Где взять UID: WEEX → Профиль → UID (числовой идентификатор аккаунта).",
  uidBackToBot: "← Войти через бота академии",
  uidFallbackNote: "Этот путь оставлен на крайний случай. Обычный вход - паролем из бота академии.",
  noAccount: "Нет аккаунта WEEX?",
  registerLink: "Зарегистрироваться →",
  uidNotFound: "UID не найден в системе",
  requestCode: "Получить код",

  codeSentTo: "Код отправлен в Telegram бот",
  wrongCode: "Неверный код",
  changeUid: "Изменить UID",
  resend: "Отправить повторно",
  resendIn: (sec: number) => `Отправить повторно (${sec}с)`,

  success: "Успешно! Перенаправляем…",
  enter: "Войти",
};
