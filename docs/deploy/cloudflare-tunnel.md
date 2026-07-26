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

Если есть `winget`:

```powershell
winget install --id Cloudflare.cloudflared
```

На Windows Server `winget` обычно отсутствует — тогда качаем бинарь напрямую
в папку проекта (дальше вызываем как `.\cloudflared.exe`):

```powershell
cd C:\Users\Администратор\Desktop\WEEX\MENTOR
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile ".\cloudflared.exe"
.\cloudflared.exe --version
```

`start.bat` и `start-tunnel.bat` делают это сами, если `cloudflared` не найден.

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

## Если туннель поднялся, а API не отвечает

В логе `cloudflared`:

```
ERR error="Unable to reach the origin service ... dial tcp [::1]:8000:
connectex: No connection could be made because the target machine actively refused it."
```

Причин две, проверять в этом порядке:

1. **Бэкенд не запущен.** Открыть `http://localhost:8000/api/health` на самой
   машине. Пусто — значит `uvicorn` упал или окно закрыли.
2. **IPv6.** `localhost` на Windows резолвится в `[::1]`, а `uvicorn --host 0.0.0.0`
   слушает только IPv4. В `C:\Users\Администратор\.cloudflared\config.yml`
   должно быть `service: http://127.0.0.1:8000`, а не `http://localhost:8000`.

Заменить одной командой:

```powershell
$c = "$env:USERPROFILE\.cloudflared\config.yml"
(Get-Content $c -Raw) -replace 'http://localhost:8000','http://127.0.0.1:8000' | Set-Content $c -Encoding UTF8
```

После правки — перезапустить туннель.

## Если API отвечает, а браузер пишет CORS

Признаки: в консоли `Причина: не удалось выполнить запрос CORS`, **`Код состояния: (null)`**,
в Network запрос падает за `0 мс` и `0 байт`. При этом `curl` с тем же `Origin`
возвращает `200` и правильные заголовки.

Это **не CORS**. Нулевой статус означает, что ответа не было вообще — Firefox
показывает такую ошибку и когда имя не разрешилось. Проверять надо DNS
**на машине с браузером** (не на той, где бэкенд):

```powershell
ipconfig /flushdns
nslookup api.nmnh.trade
```

`Non-existent domain` — резолвер закэшировал отрицательный ответ, полученный
до создания поддомена (домен только переехал на NS Cloudflare). Записи при этом
существуют глобально — легко проверить с телефона по мобильному интернету:
`https://api.nmnh.trade/api/health` отдаст JSON.

Лечится по возрастанию усилий: перезагрузка роутера → `ipconfig /flushdns` →
DNS `1.1.1.1` в настройках адаптера. Само пройдёт за несколько часов, когда
истечёт TTL отрицательного кэша. Посетителей сайта это не касается.

## Дальше

Адрес `api.nmnh.trade` постоянный — пересобирать фронт при перезапусках
туннеля больше не нужно.
