import sharp from "sharp";
import { mkdirSync } from "fs";
mkdirSync("public/icons", { recursive: true });

const bolt = (s) => `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0F0F23"/><stop offset="1" stop-color="#0A0A1A"/>
    </linearGradient>
    <linearGradient id="bolt" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0AFFE0"/><stop offset="1" stop-color="#00D4A0"/>
    </linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="${s*0.012}" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;

// иконка: фон скруглён, неоновая молния по центру
function svg(size, { round = true, pad = 0 } = {}) {
  const r = round ? size * 0.22 : 0;
  const cx = size / 2, cy = size / 2;
  const k = (size * (1 - pad)) / 512; // масштаб молнии с учётом отступа (maskable)
  // путь молнии в координатах 512, центрируем
  const path = "M300 60 L150 300 L250 300 L210 452 L380 220 L280 220 Z";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bolt(size)}
    <rect width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>
    <rect width="${size}" height="${size}" rx="${r}" fill="none" stroke="#0AFFE0" stroke-opacity="0.18" stroke-width="${size*0.01}"/>
    <g transform="translate(${cx - 256*k}, ${cy - 256*k}) scale(${k})" filter="url(#glow)">
      <path d="${path}" fill="url(#bolt)"/>
    </g>
  </svg>`;
}

const og = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0F0F23"/><stop offset="1" stop-color="#0A0A1A"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <text x="80" y="300" font-family="Inter, sans-serif" font-size="92" font-weight="800" fill="#fff">⚡ NMNH</text>
  <text x="84" y="380" font-family="Inter, sans-serif" font-size="40" font-weight="600" fill="#0AFFE0">Персональные торговые сигналы</text>
  <text x="84" y="440" font-family="Inter, sans-serif" font-size="28" fill="#CCCCCC">Реальный расчёт. Риск под контролем.</text>
</svg>`;

async function png(svgStr, out, w, h) {
  await sharp(Buffer.from(svgStr)).png().resize(w, h).toFile(out);
  console.log("✓", out);
}

await png(svg(512), "public/icons/icon-512.png", 512, 512);
await png(svg(192), "public/icons/icon-192.png", 192, 192);
await png(svg(512, { round: false, pad: 0.2 }), "public/icons/maskable-512.png", 512, 512);
await png(svg(180), "public/icons/apple-touch-icon.png", 180, 180);
await png(svg(32), "public/favicon-32.png", 32, 32);
await png(og(1200, 630), "public/og.png", 1200, 630);
