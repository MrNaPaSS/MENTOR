# WEEX API — полная карта разделов + аффилиат для админ-дашборда

> Изучение всех разделов и подразделов `weex.com/api-doc/*`. Прямой доступ ботам закрыт (403 + SPA),
> поэтому карта собрана через поиск по доке. Точные имена полей в ответах помечены «🟡 уточнить»
> (подтверждаются по живому ключу или копией страницы). Связано с [A-01](../audit/AUDIT.md),
> [`core/weex/real.py`](../../core/weex/real.py).

## 0. Общее (подтверждено)
- **Домены:** `api-spot.weex.com` (spot + affiliate/rebate), `api-contract.weex.com` /
  `contract-openapi.weex.com` (фьючерсы), broker — отдельный.
- **Типы API:** Public (без ключа, маркет/конфиг) и Private (ключ + подпись: ордера, аккаунт).
- **Подпись:** `ACCESS-SIGN = base64(HMAC_SHA256(secret, timestamp+METHOD+requestPath+"?"+queryString+body))`.
  Заголовки: `ACCESS-KEY/SIGN/TIMESTAMP/PASSPHRASE`. Время — **мс**, расхождение >30 c → отказ. ✅ совпадает с `real.py`.
- **Лимиты:** public ≈ 20 запросов / 2 c; private — по API-ключу; превышение → `429`.
- **Права ключа:** Read и/или Trade. Создание ключа: `weex.com/account/newapi`.

## 1. Карта разделов (все семейства)

### 1.1 SPOT (`/api-doc/spot/*`)
- **QuickStart:** IntegrationPreparation · InterfaceType · StandardSpecifications · Signature ·
  PublicAPIParameters · LIMITS · AccessRestrictions
- **Introduction:** APIBriefIntroduction · CommonProblem (FAQ)
- **ConfigAPI:** GetProductInfo (биржевая инфо) · CurrencyInfo (валюты)
- **MarketDataAPI:** GetTickerInfo (тикер) · GetTradeData (сделки) · (глубина, свечи/klines, все тикеры)
- **orderApi (Trade):** PlaceOrder · HistoryOrders · (отмена, открытые ордера, инфо по ордеру)
- **Account API:** assets (активы) · bills (история) · transferRecords (переводы)
- **rebate-endpoints (Affiliate)** — см. §2
- **Websocket:** websocket-intro · public (тикеры/глубина/сделки/свечи) · private (Account-Channel,
  Fill-Channel, Orders-Channel)

### 1.2 CONTRACT / FUTURES (`/api-doc/contract/*`)
- **intro · APIPublicParameters**
- **Market_API:** GetContractInfo (инфо по контрактам) · GetTradeData · (глубина, свечи, тикер, funding)
- **Account_API:** AllContractAccountsInfo (список счетов) · bills · GetSingleContractUserConfig ·
  смена плеча · корректировка маржи · авто-пополнение маржи · позиции (все/одна)
- **Trade (order) API:** размещение/отмена ордеров, ордера, филлы
- **Websocket:** public (Tickers-Channel и т.д.) · private (аккаунт/ордера/позиции)

### 1.3 BROKER (`/api-doc/broker/*`) — отдельный продукт
Для брокеров: автоматическая торговля, **управление пользователями, расчёт комиссий, суб-аккаунты**.
Бро­кер получает `brokerId` формата `WEEX+6 цифр`; `newClientOrderId` начинается с `b-{brokerId}`.
Разделы: intro · ContactUs · (создание суб-аккаунтов, привязка юзеров, отчёты по комиссии).
> Нам **не нужен** для аффилиат-модели; релевантен, только если станем брокером.

### 1.4 PARTNER (`/api-doc/partner/intro`)
Вводная партнёрской программы → ведёт к affiliate/rebate эндпоинтам (§2).

### 1.5 AI (`/api-doc/ai/*`)
API для AI-трейдинга: accountAPI · QuickStart/RequestInteraction (demo) и др. Для нас не нужен.

## 2. Affiliate / Rebate — ядро для нас (`/api-doc/spot/rebate-endpoints/*`)

| Метод | Путь | Назначение | Версии |
|---|---|---|---|
| GET | `/api/v3/rebate/affiliate/getChannelUserTradeAndAsset` | Рефералы: торговля + активы | V1/V3, spot |
| GET | `/api/v2/rebate/affiliate/getAffiliateCommission` | Комиссия аффилиата | V1/V2, spot + `contract-openapi v1` |
| POST | `/api/v2/rebate/affiliate/internalWithdrawal` | Внутренний перевод комиссии | V2 |

### 2.1 getChannelUserTradeAndAsset (главный для нас)
- **Параметры (🟡):** период `startTime`/`endTime` (ms), пагинация (`pageNo`/`pageSize`), возможно `uid`.
- **Ответ `data[]` (🟡):** `uid`, дата регистрации, объём торгов (спот/фьючерс), депозиты,
  **баланс/активы счёта**. → источник `students.balance_usdt` (A-01) и объёма торгов для аналитики.

### 2.2 getAffiliateCommission
- **Параметры (🟡):** период, пагинация. **Ответ (🟡):** суммы комиссии по периодам/рефералам.

### 2.3 internalWithdrawal
Перевод накопленной комиссии. Операционный, для дашборда не критичен.

## 3. Что из этого нужно нашему продукту
| Нужно | Раздел WEEX | Статус у нас |
|---|---|---|
| Цена пары (калькулятор, графики) | spot MarketDataAPI / contract Market_API | `real.get_price` (мок) |
| Свечи | Market_API klines | `real.get_klines` (мок) |
| Баланс/активы ученика по UID | **rebate getChannelUserTradeAndAsset** | заглушка → подключить |
| Объём торгов ученика | rebate getChannelUserTradeAndAsset | план |
| Комиссия партнёра | rebate getAffiliateCommission | план |
| Реалтайм-цены | Websocket public | свой сборщик (A-12) |

## 4. Применение в админ-дашборде
- **KPI:** всего рефералов · суммарный объём торгов · суммарные активы учеников · доход партнёра.
- **Таблица учеников:** + баланс, объём торгов, дата регистрации WEEX, депозит, комиссия; фильтр периода.
- **Код:** `core/weex/real.py` → `get_affiliate_referrals()` / `get_affiliate_commission()`
  (защитный парсинг, поля настраиваемые) → бэкенд `/api/admin/affiliate/*` (ментор) → UI `/admin`.

## 5. Покрытие и что осталось
- ✅ Просмотрены все семейства: **spot, contract, broker, partner, ai** + их подразделы (QuickStart,
  Market, Account, Trade, Websocket, rebate).
- 🟡 **Не удалось вытащить дословно**: точные имена параметров и полей внутри страниц эндпоинтов —
  сайт отдаёт боту 403 (SPA). Подтверждаем по **копии страницы** или **тест-ключу**.

## Источники
- [Partner intro](https://www.weex.com/api-doc/partner/intro) · [Broker intro](https://www.weex.com/api-doc/broker/intro)
- [Signature](https://www.weex.com/api-doc/spot/QuickStart/Signature) · [Public API Parameters](https://www.weex.com/api-doc/spot/QuickStart/PublicAPIParameters) · [LIMITS](https://www.weex.com/api-doc/spot/QuickStart/LIMITS) · [Interface Type](https://www.weex.com/api-doc/spot/QuickStart/InterfaceType)
- [getChannelUserTradeAndAsset](https://www.weex.com/api-doc/spot/rebate-endpoints/GetChannelUserTradeAndAsset) · [getAffiliateCommission](https://www.weex.com/api-doc/spot/rebate-endpoints/GetAffiliateCommission) · [Internal Withdrawal](https://www.weex.com/api-doc/spot/rebate-endpoints/InternalWithdrawal)
- [Spot Place Order](https://www.weex.com/api-doc/spot/orderApi/PlaceOrder) · [Spot Ticker](https://www.weex.com/api-doc/spot/MarketDataAPI/GetTickerInfo) · [Spot WS intro](https://www.weex.com/api-doc/spot/Websocket/websocket-intro)
- [Contract intro](https://www.weex.com/api-doc/contract/intro) · [Contract Info](https://www.weex.com/api-doc/contract/Market_API/GetContractInfo) · [Contract Accounts](https://www.weex.com/api-doc/contract/Account_API/AllContractAccountsInfo)
