/**
 * Покадровый рендер промо-ролика.
 *
 * Композиция (index.html) не анимируется браузером сама: каждый кадр
 * выставляется вызовом window.seek(t). Поэтому запись идёт не в реальном
 * времени, а кадр за кадром - результат не зависит от скорости машины.
 *
 * Запуск:  node render.mjs [--fps 30] [--scale 1] [--music path.mp3]
 */

import { chromium } from "file:///E:/NMNH_TRADE/webapp/node_modules/playwright-core/index.mjs";
import { spawn } from "node:child_process";
import { mkdir, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRAMES = path.join(ROOT, "frames");
const PAGE = process.env.PAGE || "vertical.html";
const W = Number(process.env.W || 1080);
const H = Number(process.env.H || 1920);
const OUT = path.join(ROOT, PAGE.replace(".html", "") + ".mp4");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const FPS = Number(arg("fps", 30));
const SCALE = Number(arg("scale", 1));
const MUSIC = arg("music", null);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} завершился с кодом ${code}`)),
    );
  });
}

async function main() {
  await rm(FRAMES, { recursive: true, force: true });
  await mkdir(FRAMES, { recursive: true });

  const browser = await chromium.launch({
    args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--hide-scrollbars"],
  });
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: SCALE,
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(pathToFileURL(path.join(ROOT, PAGE)).href, { waitUntil: "load" });
  await page.evaluate(() => window.ready);

  if (errors.length) {
    console.error("Ошибки страницы:\n" + errors.join("\n"));
    await browser.close();
    process.exit(1);
  }

  const duration = await page.evaluate(() => window.DURATION);
  const total = Math.round(duration * FPS);
  console.log(`Рендер ${total} кадров (${duration}s @ ${FPS}fps, x${SCALE})`);

  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    await page.evaluate((time) => window.seek(time), t);
    await page.screenshot({
      path: path.join(FRAMES, `f_${String(i).padStart(5, "0")}.jpg`),
      type: "jpeg",
      quality: 96,
      animations: "disabled",
    });
    if (i % 60 === 0) console.log(`  ${i}/${total}`);
  }

  await browser.close();

  const frames = (await readdir(FRAMES)).length;
  if (frames !== total) throw new Error(`Кадров на диске ${frames}, ожидалось ${total}`);

  const ffArgs = [
    "-y",
    "-framerate", String(FPS),
    "-i", path.join(FRAMES, "f_%05d.jpg"),
  ];
  if (MUSIC) ffArgs.push("-i", MUSIC, "-shortest", "-c:a", "aac", "-b:a", "192k");
  ffArgs.push(
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    OUT,
  );

  await run("ffmpeg", ffArgs);
  console.log(`Готово: ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
