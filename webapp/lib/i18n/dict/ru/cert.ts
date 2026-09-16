// Сертификат трейдера: уровни, цели, окно и уведомление.
//
// В коде они по-прежнему `pillars` - переименование ключей задело бы и
// сервер, и бланк; на экране человек читает «цели».

export const cert = {
  title: "Сертификаты трейдера",
  hint: "за знания, практику, дисциплину и развитие",
  levels: {
    bronze: "Бронза",
    silver: "Серебро",
    gold: "Золото",
  },
  need: (n: number) => `Целей: ${n} из 4`,
  left: (n: number) => `Не хватает целей: ${n}`,
  issued: (date: string) => `Выдан ${date}`,
  open: "Открыть и получить",
  pillars: {
    knowledge: "Знания",
    practice: "Практика",
    discipline: "Дисциплина",
    growth: "Развитие",
  },
  pillarHow: {
    knowledge: "Пройти курс в академии NMNH",
    practice: "50 сделок через терминал, подтверждённых биржей",
    discipline: "20 торговых дней, у каждой сделки стоп",
    growth: "Календарный месяц в плюсе, от 10 сделок",
  },
  onCard: {
    knowledgeDone: "курс пройден",
    knowledgeNo: "курс не пройден",
    practice: (n: number) => `сделок: ${n}`,
    discipline: (n: number) => `дней со стопом: ${n}`,
    growthDone: "месяц в плюсе",
    growthNo: "месяца в плюсе нет",
  },
  number: (n: string) => `№ ${n}`,
  alt: (owner: string) => `Сертификат трейдера NMNH: ${owner}`,
  dialogTitle: (level: string) => `Сертификат трейдера · ${level}`,
  toastTitle: (level: string) => `Сертификат трейдера: ${level}`,
  toastText: "Нажмите, чтобы получить",
  copy: "Скопировать",
  download: "Скачать",
  copied: "Сертификат скопирован",
  copyFailed: "Браузер не дал скопировать - скачайте файлом",
  saved: "Сертификат сохранён",
  failed: "Не удалось собрать сертификат",
  assembling: "Готовим сертификат…",
  close: "Закрыть",
};
