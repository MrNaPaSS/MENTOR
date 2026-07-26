# Деплой фронта на Render + туннель к бэкенду

## Схема

```
Браузер ──► https://www.nmnh.trade/api/...   (Render Static Site, тот же домен)
                        │  Rewrite
                        ▼
            https://<туннель>.ngrok-free.dev/api/...   (сервер → сервер)
                        │
                        ▼
              uvicorn backend.main:app  (удалённый рабочий стол, :8000)
```

Браузер общается **только** со своим доменом. Поэтому CORS и preflight `OPTIONS`
не задействуются, а ngrok не показывает страницу-предупреждение (её видят только браузеры,
а сюда приходит запрос от сервера Render).

## Почему нельзя указывать адрес туннеля напрямую

Если во фронт вшить `NEXT_PUBLIC_API_URL=https://<туннель>.ngrok-free.dev`, браузер
увидит **другой домен** и перед каждым запросом отправит preflight `OPTIONS`.
В preflight браузер **не передаёт кастомные заголовки**, поэтому заголовок
`ngrok-skip-browser-warning` до ngrok не доходит — тот отвечает `403`, и браузер
показывает `CORS error`. До FastAPI запрос вообще не доходит (в ngrok видно `Connections: 0`).

## Настройка на Render (Dashboard)

Сервис создан вручную, поэтому `render.yaml` сам не применяется — правила задаются в панели.

**1. Убрать прямой адрес API**

`Dashboard → MENTOR → Environment → Environment Variables`

Переменную `NEXT_PUBLIC_API_URL` **удалить** (или оставить значение пустым).
Она переопределяет `webapp/.env.production`, где адрес намеренно пуст.

**2. Добавить правила Rewrite**

`Dashboard → MENTOR → Redirects/Rewrites → Add Rule`

| Source | Destination | Action |
|---|---|---|
| `/api/*` | `https://preformed-unadvised-slicing.ngrok-free.dev/api/*` | **Rewrite** |
| `/pln/*` | `https://preformed-unadvised-slicing.ngrok-free.dev/pln/*` | **Rewrite** |

Именно `Rewrite`, не `Redirect`: при Redirect браузер уйдёт на домен туннеля, и
вернётся исходная проблема с CORS.

**3. Задеплоить**

`Manual Deploy → Deploy latest commit` (в панели был закреплён старый коммит `ee401a8`).

## Проверка

1. Открыть `https://www.nmnh.trade`, войти.
2. `F12 → Network`: запросы идут на `www.nmnh.trade/api/...`, статус `200`,
   строк `preflight` и `CORS error` быть не должно.
3. В окне ngrok счётчик `Connections` перестаёт быть нулевым.

## При смене адреса туннеля

Меняется **только** Destination в правилах Rewrite (и, для истории, `render.yaml`).
Фронт пересобирать не нужно — адрес туннеля в бандл не попадает.

## Бэкенд

`ALLOWED_ORIGINS` при такой схеме не критичен (запросы приходят server-to-server),
но для прямых обращений полезно указать явно:

```
ALLOWED_ORIGINS=https://www.nmnh.trade,https://nmnh.trade
```

Бэкенд включает `allow_credentials` только при явном списке доменов: сочетание
`*` + credentials браузер отвергает по спецификации CORS.
