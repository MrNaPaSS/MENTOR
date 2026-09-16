// Витрина «Реальные PnL» нашими карточками.
//
// В `public/pln` лежали скриншоты биржи: чужой логотип, чужой реферальный код
// и обещание чужого бонуса на всю нижнюю панель. Показывать их со своего
// лендинга - рекламировать биржу вместо терминала, поэтому те же сделки
// перерисованы нашим бланком: цифры сделки остаются биржевыми, оформление -
// наше.
//
// Рисует не копия разметки, а тот самый модуль, которым карточку собирает
// журнал (`lib/pnl/card.ts`). Копия однажды разошлась бы с оригиналом, и
// витрина показывала бы карточку, которой у человека не получится.
//
// Запуск:  node scripts/render-pnl.mjs
// Нужен собранный `.next` - оттуда берутся файлы шрифта Inter, тем же набором,
// что на сайте. Без него текст лёг бы системным шрифтом и поехал по ширине.

import { createServer } from "node:http";
import { readFile, writeFile, readdir, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const OUT = path.join(PUBLIC, "pln");
const TMP = path.join(ROOT, ".pnl-build");

/** Часовой пояс наставника: время на карточке подписано им же. */
const TIMEZONE = "Europe/Berlin";

/** Качество JPEG. Карточку разглядывают, но она едет по мобильной сети. */
const QUALITY = 0.92;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

/** Собрать модуль карточки в один файл для браузера. */
async function bundle() {
  await build({
    configFile: false,
    logLevel: "warn",
    resolve: { alias: { "@": ROOT } },
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env": "({})",
    },
    build: {
      outDir: TMP,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: path.join(ROOT, "scripts", "pnl-entry.ts"),
        formats: ["iife"],
        name: "PnlCard",
        fileName: () => "card.js",
      },
    },
  });
  return readFile(path.join(TMP, "card.js"), "utf8");
}

/**
 * Шрифт сайта - тот же, что на странице.
 *
 * `next/font` кладёт Inter в сборку под своим именем и режет по алфавитам;
 * забираем все его объявления целиком и возвращаем семье привычное имя -
 * холст просит шрифт по нему.
 */
async function fontFaces() {
  const dir = path.join(ROOT, ".next", "static", "css");
  if (!existsSync(dir)) {
    throw new Error("Нет .next/static/css - соберите сайт: npm run build");
  }
  const files = await readdir(dir);
  const sheets = await Promise.all(
    files
      .filter((f) => f.endsWith(".css"))
      .map((f) => readFile(path.join(dir, f), "utf8")),
  );
  const faces = sheets
    .join("\n")
    .match(/@font-face\{[^}]*\}/g)
    ?.filter((face) => /font-family:__Inter_/.test(face))
    .map((face) => face.replace(/font-family:__Inter_[^;]*/, 'font-family:"Inter"'));
  if (!faces || faces.length === 0) throw new Error("В сборке нет Inter");
  return faces.join("\n");
}

/** Раздача заготовок и шрифтов: холст не отдаёт пиксели картинке с чужого хоста. */
function serve(page) {
  return createServer(async (req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(page);
      return;
    }
    // `/_next/...` - файлы шрифта из сборки, всё остальное - из `public`.
    const file = url.startsWith("/_next/")
      ? path.join(ROOT, ".next", url.slice("/_next/".length))
      : path.join(PUBLIC, url);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
}

/** Страница-мастерская: шрифт, модуль карточки и пустой холст. */
function workshop(faces, script) {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<style>${faces}</style>
</head><body>
<script>${script}</script>
</body></html>`;
}

async function main() {
  const spec = JSON.parse(await readFile(path.join(ROOT, "scripts", "pnl-showcase.json"), "utf8"));
  const [script, faces] = await Promise.all([bundle(), fontFaces()]);

  const server = serve(workshop(faces, script));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();

  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: "ru-RU",
    timezoneId: TIMEZONE,
    deviceScaleFactor: 1,
  });
  const tab = await context.newPage();
  await tab.goto(`http://127.0.0.1:${port}/`);

  // Холст не ждёт шрифт сам: не дождавшись, он молча рисует системным.
  await tab.evaluate(async () => {
    const weights = [500, 600, 700, 800];
    await Promise.all(weights.map((w) => document.fonts.load(`${w} 64px "Inter"`, "0123456789%АБВ")));
    await document.fonts.ready;
  });

  await mkdir(OUT, { recursive: true });
  // Старые скриншоты биржи уезжают целиком: витрина показывает папку как есть,
  // и оставленный файл вернулся бы на лендинг вместе с новыми.
  for (const name of await readdir(OUT)) await rm(path.join(OUT, name));

  const written = [];
  for (const trade of spec.trades) {
    const shot = await tab.evaluate(
      async ({ trade, owner, quality }) => {
        const { VARIANTS, render, price, stamped } = window.PnlCard;
        const variant = VARIANTS.find((v) => v.id === trade.variant);
        if (!variant) throw new Error(`нет заготовки ${trade.variant}`);
        const side = trade.side === "long" ? "Лонг" : "Шорт";
        const card = {
          title: trade.symbol,
          subtitle: `${side}   |   ${trade.leverage}x`,
          side: trade.side,
          roi: trade.roi,
          pnl: trade.pnl,
          rows: [
            ["Цена входа", price(trade.entry)],
            ["Цена выхода", price(trade.exit)],
          ],
          footer: ["Дата и время", stamped(trade.at)],
          at: trade.at,
          owner,
          venue: "WEEX Futures",
        };
        const canvas = await render(card, variant, true);
        return canvas.toDataURL("image/jpeg", quality);
      },
      { trade, owner: spec.owner, quality: QUALITY },
    );

    const name = `${trade.file}.jpg`;
    await writeFile(path.join(OUT, name), Buffer.from(shot.split(",")[1], "base64"));
    written.push(name);
    console.log(`${name}  ${trade.symbol} ${trade.side} ${trade.roi}%  ${trade.variant}`);
  }

  await browser.close();
  server.close();
  await rm(TMP, { recursive: true, force: true });
  console.log(`\nГотово: ${written.length} карточек в public/pln`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
