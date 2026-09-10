// Награды, которые ждут получения: значок на шапке, окно «Забрать» и уведомления.
//
// Подписи с числом построены через двоеточие («Ждут получения: 3»), а не
// через склонение: «1 награда ждут» и «5 награды» хуже, чем честное число.

export const rewards = {
  title: "Награды",
  hint: "ждут получения",
  chipTitle: "Монеты NMNH - нажмите, чтобы открыть награды",
  badge: (n: number) => `Ждут получения: ${n}`,
  empty: "Новых наград нет. Они приходят за плюсовые сделки, серии, достижения и уроки академии.",
  claimAll: "Забрать все",
  claiming: "Забираем…",
  claimError: "Не получилось забрать. Попробуйте ещё раз.",
  total: "Итого",
  debtNote: "Убыток на пустом балансе вычитается из наград.",
  history: "История начислений",
  spend: "Потратить в маркете",

  toastOneTitle: (amount: string) => `+${amount} NMNH`,
  toastOneText: (label: string) => `${label} · нажмите, чтобы забрать`,
  toastManyTitle: (n: number) => `Награды ждут получения: ${n}`,
  toastManyText: (amount: string) => `+${amount} NMNH · нажмите, чтобы забрать`,

  level: (n: number) => `Уровень ${n}`,
  streak: (n: number) => `Серия плюсов: ${n} подряд`,
  milestone: (label: string) => `Веха объёма ${label}`,
  achievement: (title: string) => `Достижение «${title}»`,

  reasons: {
    trade_win: "Плюсовая сделка",
    trade_streak: "Серия плюсов",
    trade_loss: "Долг за убыток",
    streak_freeze: "Серия заморожена",
    achievement: "Достижение",
    level_up: "Новый уровень",
    volume_milestone: "Веха объёма",
    academy: "Академия",
    academy_joined: "Первый заход в академию",
    module_completed: "Модуль пройден",
    test_passed: "Тест сдан",
    course_completed: "Курс пройден",
    verification: "Верификация",
    friend_invited: "Друг зарегистрировался",
    friend_verified: "Друг верифицировался",
    homework_accepted: "Домашка принята",
    lesson_watched: "Урок просмотрен",
    streak_lessons_7: "Неделя занятий без пропуска",
    streak_lessons_30: "Месяц занятий без пропуска",
    purchase: "Покупка в маркете",
    refund: "Возврат за заказ",
    other: "Награда",
  },
};
