// Профиль: всё, что человек знает и меняет про себя.

export const profile = {
  avatarAlt: "аватар",
  balance: "Баланс",
  balanceFromKeys: "● По вашим ключам WEEX",
  balanceFromAffiliate: "● Синхронизировано с WEEX",
  balanceManual: "● Введено вручную",

  exchangeTitle: "Биржевой счёт",
  connected: "подключён",
  disconnected: "не подключён",
  keyTail: (tail: string) => `Ключ ···${tail}`,
  keySince: (date: string) => ` · с ${date}`,
  vaultOff: "Хранилище ключей не настроено на сервере",
  noKeys: "Без ключей торговля из терминала недоступна",
  keysNote:
    "Ключи хранятся зашифрованными и в браузер не возвращаются - только последние символы для опознания. Создавайте их с правом на торговлю и без права на вывод средств.",

  settings: "Настройки",
  theme: "Тема оформления",
  themeLight: "Светлая",
  themeDark: "Тёмная",
  language: "Язык интерфейса",
  sound: "Звук событий",
  cardName: "Ник на карточке",
  cardNamePlaceholder: "как в Telegram",
  cardNameHint: "Пусто — подпись возьмётся из Telegram",

  adminPanel: "Админ панель",
  logoutAccount: "Выйти из аккаунта",
};
