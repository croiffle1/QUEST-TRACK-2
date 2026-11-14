// 앱 아이콘 만들기 도구
// 쓰는 법 (QUEST-TRACK-2 폴더에서):  node week-06/icons/make-icons.mjs
// 해와 구름 그림(SVG)을 만들고, Edge(없으면 Chrome)로 PNG 사진을 찍어 아이콘으로 저장한다.
//  - icon.svg            : 그림 원본
//  - icon-192.png / icon-512.png : 보통 아이콘 (모서리 둥근 네모)
//  - maskable-512.png    : 폰이 동그라미 · 네모 등으로 잘라 쓰는 아이콘 (그림을 가운데 안전 구역에 둠)
//  - apple-touch-icon.png: 아이폰 홈 화면 아이콘 (180)

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, ".browser-tmp");
const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];
const browser = BROWSERS.find(existsSync);
if (!browser) { console.log("Edge 나 Chrome 을 찾지 못했어요."); process.exit(1); }

// round: 배경 모서리 둥글기 (0 이면 꽉 찬 네모), scale: 그림 크기 (maskable 은 작게 해서 안전 구역 안에)
function svg(round, scale) {
  const s = scale, c = 256;
  const t = (x) => c + (x - c) * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#1d4ed8"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${round}" fill="url(#sky)"/>
  <g transform="translate(${t(0)} ${t(0)}) scale(${s})">
    <circle cx="200" cy="190" r="92" fill="#fbbf24"/>
    <g stroke="#fbbf24" stroke-width="22" stroke-linecap="round">
      <line x1="200" y1="58" x2="200" y2="78"/><line x1="68" y1="190" x2="88" y2="190"/>
      <line x1="107" y1="97" x2="121" y2="111"/><line x1="293" y1="97" x2="279" y2="111"/>
      <line x1="107" y1="283" x2="121" y2="269"/>
    </g>
    <path d="M150 400 h220 a70 70 0 0 0 0 -140 a100 100 0 0 0 -190 20 a62 62 0 0 0 -30 120 z" fill="#ffffff"/>
  </g>
</svg>`;
}

const jobs = [
  ["icon.svg", svg(112, 1), null],
  ["icon-512.png", svg(112, 1), 512],
  ["icon-192.png", svg(112, 1), 192],
  ["maskable-512.png", svg(0, 0.72), 512],
  ["apple-touch-icon.png", svg(0, 0.86), 180],
];

for (const [name, text, size] of jobs) {
  if (!size) { writeFileSync(join(HERE, name), text); console.log("만듦: " + name); continue; }
  // 크기에 맞춘 HTML 한 장을 만들어 사진을 찍는다
  const page = join(HERE, ".tmp-" + size + ".html");
  writeFileSync(page, `<!doctype html><html><body style="margin:0;background:transparent">
<img src="data:image/svg+xml;base64,${Buffer.from(text).toString("base64")}" width="${size}" height="${size}" style="display:block"></body></html>`);
  rmSync(TMP, { recursive: true, force: true });
  spawnSync(browser, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${TMP}`,
    "--default-background-color=00000000", `--window-size=${size},${size}`,
    `--screenshot=${join(HERE, name)}`, pathToFileURL(page).href,
  ], { stdio: "ignore", timeout: 30000 });
  rmSync(page, { force: true });
  console.log((existsSync(join(HERE, name)) ? "만듦: " : "못 만듦: ") + name);
}
rmSync(TMP, { recursive: true, force: true });
