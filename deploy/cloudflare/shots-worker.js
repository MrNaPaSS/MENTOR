/**
 * Заслонка перед снимками: что видит посторонний, когда сервер выключен.
 *
 * Ссылку на снимок или карточку сделки отправляют людям - в форум, в личные
 * сообщения, в чужие чаты. Открывают её те, кто про наш рабочий стол и туннель
 * не знает ничего. Пока сервер выключен, Cloudflare отвечает за него сам, и
 * ответ этот - «Error 1033: Argo Tunnel error» на английском, с чужим
 * логотипом и предложением обратиться к владельцу сайта. Человек, которому
 * прислали график, видит поломку и уходит.
 *
 * Экран обновления на сайте здесь не поможет: страницу снимка отдаёт бэкенд, а
 * когда его нет, до нашего кода запрос не доходит вовсе. Ответить может только
 * тот, кто стоит перед ним, - то есть край Cloudflare. Этим и занят воркер:
 * живые ответы он пропускает насквозь, а любой экран ошибки - и отказ туннеля,
 * и падение самого сервера, и ненайденный снимок - подменяет своим.
 *
 * Ставится на отдельное имя (s.nmnh.trade), а не на api.nmnh.trade. Причина
 * простая: снимки открывают люди - это десятки запросов в день, - а в API
 * ломится сам терминал, и заводить на его поток посредника с дневным пределом
 * бесплатного тарифа значит однажды положить терминал руками.
 *
 * Развёртывание: docs/deploy/cloudflare-tunnel.md, раздел «Снимки без 1033».
 */

// Где лежат ролик и знак. На сайте, а не на бэкенде: бэкенда в этот момент
// как раз и нет.
const SITE = "https://www.nmnh.trade";

// Что показываем вместо чужого экрана ошибки.
//
// Заслонка одна на все поломки - так же, как на сайте: снаружи разница между
// «туннель закрыт», «сервер споткнулся» и «снимка нет» неразличима, человек в
// любом случае не увидел того, за чем пришёл. Отличаются только слова и
// предложение под ними.
const OFFLINE = {
  status: 503,
  title: "Сервер обновляется",
  note: "Снимок откроется через пару минут. Обновлять страницу не нужно, он появится сам, как только сервер ответит.",
  // Возвращаемся сами: человек оставил вкладку открытой, и ждать от него
  // нажатия F5 значит терять того, кому график и был отправлен.
  reload: true,
};

const MISSING = {
  status: 404,
  title: "Снимка нет",
  note: "Ссылка устарела или снимок удалили. Свежие графики и разборы - на сайте.",
  reload: false,
};

export default {
  async fetch(request) {
    let response;
    try {
      response = await fetch(request);
    } catch {
      // До сервера не достучались вовсе: туннель закрыт.
      return instead(request, OFFLINE);
    }

    // 502-504 и 520-530 - это ответ края за отсутствующий сервер (530 - тот
    // самый 1033); 5xx - сам сервер, который споткнулся. И то и другое значит
    // «сейчас здесь пусто», и показывать это чужими словами незачем.
    if (response.status >= 500) return instead(request, OFFLINE);

    // Снимка нет. Сервер отвечает на это разбором для программы
    // ({"detail": ...}), а читает его человек, которому прислали ссылку.
    if (response.status === 404) return instead(request, MISSING);

    return response;
  },
};

/**
 * Ответ вместо чужого экрана ошибки.
 *
 * Человеку - страница с роликом и надписью; всему остальному - тот же код и
 * короткий разбор. Отдавать HTML в ответ на запрос картинки бессмысленно: его
 * никто не прочтёт, а разворачивающий превью мессенджер запомнит поломку и не
 * станет пробовать снова.
 */
function instead(request, what) {
  const wants = request.headers.get("accept") || "";
  const headers = {
    // Заслонка временная по смыслу, и кэшировать её нельзя ни на минуту:
    // сервер вернётся раньше, чем истечёт любой разумный срок.
    "cache-control": "no-store",
    "retry-after": "60",
  };

  if (!wants.includes("text/html")) {
    return new Response(JSON.stringify({ detail: what.title }), {
      status: what.status,
      headers: { ...headers, "content-type": "application/json; charset=utf-8" },
    });
  }

  return new Response(page(what), {
    status: what.status,
    headers: { ...headers, "content-type": "text/html; charset=utf-8" },
  });
}

function page(what) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${what.title} · NMNH</title>
<meta name="robots" content="noindex">
<meta property="og:title" content="${what.title}">
<meta property="og:description" content="${what.note}">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; position: relative; overflow: hidden;
    background: #000; color: #fff;
    font: 14px/1.5 "Inter", system-ui, -apple-system, sans-serif;
    display: flex; align-items: center; justify-content: center;
  }
  video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  /* Полотна поверх ролика нет: надпись держится на собственной тени. */
  main {
    position: relative; max-width: 26rem; padding: 0 24px; text-align: center;
    text-shadow: 0 2px 18px rgba(0,0,0,.85), 0 1px 3px rgba(0,0,0,.9);
  }
  /* Знак - тот же, что в шапке сайта и на странице снимка: с тем же разрывом
     цвета. Разные написания в разных местах читаются как разные хозяева. */
  .mark {
    position: relative; display: inline-block; margin-bottom: 20px;
    font-size: 13px; font-weight: 800; letter-spacing: .2em; text-transform: uppercase;
    color: #fff;
  }
  .mark::before, .mark::after {
    content: attr(data-text); position: absolute; inset: 0;
    pointer-events: none; opacity: .85;
  }
  .mark::before { color: #0affe0; animation: glitch-x 3.4s infinite steps(2, end); clip-path: inset(0 0 60% 0); }
  .mark::after { color: #f6465d; animation: glitch-y 2.8s infinite steps(2, end); clip-path: inset(60% 0 0 0); }
  @keyframes glitch-x {
    0%, 86%, 100% { transform: translate(0); opacity: 0; }
    88% { transform: translate(-3px, -1px); opacity: .9; }
    92% { transform: translate(3px, 1px); opacity: .9; }
    96% { transform: translate(-2px, 1px); opacity: .6; }
  }
  @keyframes glitch-y {
    0%, 86%, 100% { transform: translate(0); opacity: 0; }
    89% { transform: translate(3px, 1px); opacity: .9; }
    93% { transform: translate(-3px, -1px); opacity: .9; }
    97% { transform: translate(2px, -1px); opacity: .6; }
  }
  h1 { margin: 0; font-size: 30px; font-weight: 800; letter-spacing: -.02em; }
  p { margin: 12px 0 0; font-size: 14px; color: rgba(255,255,255,.9); }
  a {
    display: inline-block; margin-top: 26px; padding: 10px 20px; border-radius: 999px;
    background: #fff; color: #000; font-size: 13px; font-weight: 700; text-decoration: none;
  }
  @media (prefers-reduced-motion: reduce) {
    video { display: none; }
    .mark::before, .mark::after { animation: none; }
  }
</style>
</head>
<body>
  <video src="${SITE}/maintenance.mp4" poster="${SITE}/maintenance.jpg" autoplay loop muted playsinline></video>
  <main>
    <span class="mark" data-text="NMNH.TRADE">NMNH.TRADE</span>
    <h1>${what.title}</h1>
    <p>${what.note}</p>
    <a href="${SITE}">На сайт</a>
  </main>
  ${what.reload ? "<script>setTimeout(function () { location.reload(); }, 15000);</script>" : ""}
</body>
</html>`;
}
