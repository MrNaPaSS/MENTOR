# WEEX Affiliate (Partner) API — изучение для админ-дашборда

> Источник: официальная дока WEEX (`weex.com/api-doc/...`). Прямой доступ ботам закрыт (403 + SPA),
> поэтому ниже — то, что подтверждено через поиск по доке. Точные имена полей в `data[]` помечены
> «🟡 уточнить» — подтверждаются по живому ключу или копией страницы.
>
> Связано с: [решение A-01](../audit/AUDIT.md), [`core/weex/real.py`](../../core/weex/real.py).

## 1. Базовые домены
| Назначение | Базовый URL |
|---|---|
| Affiliate / Rebate / Spot | `https://api-spot.weex.com` |
| Futures (контракты) | `https://api-contract.weex.com` |

## 2. Авторизация и подпись (подтверждено)
Заголовки на каждый приватный запрос:
- `ACCESS-KEY` — API-ключ.
- `ACCESS-SIGN` — `base64( HMAC_SHA256( secret, prehash ) )`.
- `ACCESS-TIMESTAMP` — Unix-время в **миллисекундах**. Запрос отклоняется при расхождении >30 c с сервером.
- `ACCESS-PASSPHRASE` — пользовательская фраза.

**Prehash-строка:**
```
timestamp + METHOD.toUpperCase() + requestPath + ("?" + queryString если есть) + body
```
- GET: body пустой; queryString — параметры после `?`.
- ✅ Совпадает с нашей реализацией `core/weex/real.py::sign()` (для аффилиат-вызовов подписываем `path + "?" + query`).

**Конверт ответа (WEEX/Bitget-стиль):** `{ "code": "...", "msg": "...", "requestTime": <ms>, "data": ... }`.
Ключи API создаются в `weex.com/account/newapi`; аккаунт должен быть в **Affiliate-программе**.

## 3. Эндпоинты партнёра (подтверждено)

| # | Метод | Путь | Назначение | Лимит |
|---|---|---|---|---|
| 1 | GET | `/api/v3/rebate/affiliate/getChannelUserTradeAndAsset` | Данные рефералов: торговля и активы | вес 20 (IP/UID) |
| 2 | GET | `/api/v2/rebate/affiliate/getAffiliateCommission` | Комиссия аффилиата | вес 20 (IP/UID) |
| 3 | POST | `/api/.../rebate/.../internalWithdrawal` | Внутренний перевод комиссии | — |

### 3.1 getChannelUserTradeAndAsset — рефералы: торговля и активы
Главный эндпоинт для нас: список приглашённых пользователей с их UID, объёмом торгов и активами.
- **Параметры (🟡 уточнить точные имена):** период (`startTime`/`endTime`, ms), пагинация
  (`pageNo`/`pageSize` или `pageNum`/`limit`), возможно фильтр по `uid`.
- **Ответ `data` (🟡 уточнить):** массив пользователей; ожидаемые поля по смыслу:
  `uid`, время регистрации, объём торгов (спот/фьючерс), депозиты, **баланс/активы счёта**.
- 👉 Отсюда берём `students.balance_usdt` по UID (решение A-01) и объём торгов для аналитики.

### 3.2 getAffiliateCommission — комиссия
- **Параметры (🟡):** период `startTime`/`endTime`, пагинация.
- **Ответ (🟡):** суммы комиссии по периодам/рефералам.
- 👉 KPI «доход партнёра» и разбивка по ученикам в панели ментора.

### 3.3 internalWithdrawal — перевод комиссии
Перевод накопленной комиссии между счетами. Для дашборда не критичен (операционный).

## 4. Применение в админ-дашборде (план)

### KPI-блок (из аффилиат-API)
| KPI | Источник |
|---|---|
| Всего рефералов (учеников) | кол-во записей `getChannelUserTradeAndAsset` |
| Суммарный объём торгов | сумма объёма по рефералам |
| Суммарные активы учеников | сумма баланса/активов по рефералам |
| Доход партнёра (комиссия) | `getAffiliateCommission` за период |

### Таблица учеников (обогащение существующей `/admin/students`)
К нашим полям (ник, режим) добавить из WEEX по UID: **баланс/активы**, **объём торгов**,
**дата регистрации на WEEX**, **депозит**, **комиссия** ученика. Фильтры периода `[Сегодня/Неделя/Месяц/Всё]`.

### Как заводим в нашем коде
1. `core/weex/real.py`: методы `get_affiliate_referrals(period, page)` и `get_affiliate_commission(period)`
   поверх `_get(..., signed=True, affiliate=True)`; защитный парсинг полей (имена настраиваемые,
   как уже сделано для баланса — `WEEX_AFFILIATE_BALANCE_PATH`).
2. Бэкенд: эндпоинты `GET /api/admin/affiliate/overview` и `/api/admin/affiliate/referrals`
   (только ментор) → агрегируют данные WEEX, кэшируют (TTL), отдают фронту.
3. Фронт `/admin`: KPI + таблица из этих эндпоинтов; на моках — синтетика, на ключах — реальные.
4. Синхронизация баланса учеников (`bot/scheduler/balance_sync`) переключается на реальный
   `getChannelUserTradeAndAsset` (сейчас мок).

## 5. Что нужно, чтобы финализировать точные поля
- **Вариант А (быстро):** скопировать текст двух страниц
  ([referral data](https://www.weex.com/api-doc/spot/rebate-endpoints/GetChannelUserTradeAndAsset),
  [commission](https://www.weex.com/api-doc/spot/rebate-endpoints/GetAffiliateCommission)) — впишу
  точные имена параметров/полей.
- **Вариант Б:** дать реальный аффилиат-ключ (на тест) — снимем фактический ответ и зафиксируем схему.

## Источники
- [Get Affiliate Referral Data (getChannelUserTradeAndAsset)](https://www.weex.com/api-doc/spot/rebate-endpoints/GetChannelUserTradeAndAsset)
- [Get Affiliate Commission (getAffiliateCommission)](https://www.weex.com/api-doc/spot/rebate-endpoints/GetAffiliateCommission)
- [Signature](https://www.weex.com/api-doc/spot/QuickStart/Signature)
- [API Public Parameters](https://www.weex.com/api-doc/spot/QuickStart/PublicAPIParameters)
- [Internal Withdrawal](https://www.weex.com/api-doc/spot/rebate-endpoints/InternalWithdrawal)
