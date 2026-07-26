# Cloudflare Tunnel вместо ngrok

## Зачем меняем

У ngrok Free — **1 ГБ трафика в месяц**. Когда лимит исчерпан, туннель остаётся
`online`, но отдаёт `ERR_NGROK_725` на все запросы. Снаружи это выглядит как
«сайт не может достучаться до API»: `CORS error`, `Failed to fetch`,
а в окне ngrok `Connections: 0`. Именно это и произошло — код был исправен.

| | ngrok Free | Cloudflare Tunnel |
|---|---|---|
| Трафик | 1 ГБ/мес | **без лимита** |
| Адрес | меняется (на free — статичный, но один) | **постоянный `api.nmnh.trade`** |
| Предупреждение браузеру | есть (ломает CORS preflight) | нет |
| Цена | $0 | **$0** |

## Требование

Домен `nmnh.trade` должен обслуживаться в Cloudflare (его NS-серверы).
Проверить: `dashboard.cloudflare.com` → сайт `nmnh.trade` в списке.

Если домена там нет — добавить (бесплатно): `Add a site` → выбрать Free →
Cloudflare покажет два NS-сервера → прописать их у регистратора домена.
Записи `nmnh.trade` и `www.nmnh.trade`, ведущие на Render, при переносе
сохраняются — сайт продолжит работать.

## Установка на удалённом рабочем столе (Windows)

**1. Поставить cloudflared**

```powershell
winget install --id Cloudflare.cloudflared
```

Проверка: `cloudflared --version`

**2. Войти в аккаунт Cloudflare** (откроется браузер, выбрать домен `nmnh.trade`)

```powershell
cloudflared tunnel login
```

**3. Создать туннель**

```powershell
cloudflared tunnel create nmnh-api
```

Команда напечатает **Tunnel ID** и путь к файлу `<TUNNEL-ID>.json` — они нужны дальше.

**4. Привязать поддомен**

```powershell
cloudflared tunnel route dns nmnh-api api.nmnh.trade
```

DNS-запись `api.nmnh.trade` создастся автоматически (поддомен сейчас свободен).

**5. Создать конфиг**

Скопировать `deploy/cloudflared/config.example.yml` из репозитория в
`C:\Users\Администратор\.cloudflared\config.yml` и подставить свой `TUNNEL-ID`
в двух местах.

**6. Запустить**

```powershell
cloudflared tunnel run nmnh-api
```

Либо, чтобы поднимался сам после перезагрузки (из окна администратора):

```powershell
cloudflared service install
```

## Настройка приложения

**Бэкенд** — в `.env` на удалённом рабочем столе:

```
ALLOWED_ORIGINS=https://www.nmnh.trade,https://nmnh.trade
```

Это обязательно. Без явного списка используется `*`, а сочетание `*` с
`allow_credentials=True` браузер по спецификации CORS отвергает.
После правки — перезапустить uvicorn.

**Фронт** — в Render: `Environment → NEXT_PUBLIC_API_URL`:

```
https://api.nmnh.trade
```

Затем `Manual Deploy → Deploy latest commit`.

## Проверка

1. `https://api.nmnh.trade/api/health` в браузере → JSON `{"status":"ok",...}`
   (без страниц-предупреждений).
2. Вход на `https://www.nmnh.trade` проходит; в `F12 → Network` запросы к
   `api.nmnh.trade` со статусом `200`, без `CORS error`.

## Дальше

Адрес `api.nmnh.trade` постоянный — пересобирать фронт при перезапусках
туннеля больше не нужно.
