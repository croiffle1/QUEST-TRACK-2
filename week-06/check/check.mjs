// 날씨 앱 확인 도구
// 쓰는 법 (QUEST-TRACK-2 폴더에서):
//   node week-06/check/check.mjs            ← 내 앱 (week-06/index.html)
// Edge(없으면 Chrome)를 화면 없이 띄워서 앱을 열고, 여러 상황을 만들어 보고, 사진을 찍는다.
// 사진은 check/shots/, 브라우저 임시 폴더는 check/.browser-tmp/ 에 생긴다. (둘 다 커밋 안 함)
//
// 확인하는 것
//  1. 진짜 인터넷으로 날씨를 받아 와 보여 주는지
//  2. 불러오는 동안 "불러오는 중"이 보이는지
//  3. 못 받아 왔을 때(인터넷 끊김 · 서버 오류 · 이상한 내용) 빈 화면 대신 까닭이 보이는지
//  4. "다시 불러오기" 단추가 되는지
//  5. 날씨 번호가 모두 한국어 낱말로 바뀌는지
//  6. 폰 · 태블릿 · 컴퓨터 화면 폭에서 잘리거나 옆으로 밀리지 않는지
//  7. 못 받아 왔을 때 마지막으로 받은 날씨를 "언제 받은 것인지"와 같이 보여 주는지
//  8. 폰에 설치되는 앱(PWA)인지: GitHub Pages 와 같은 주소(/QUEST-TRACK-2/week-06/)로 작은 서버를 켜서
//     manifest · 아이콘 · 서비스 워커 · 설치 가능 여부 · 인터넷이 끊겨도 앱이 열리는지
//  9. 브라우저 오류 메시지가 없는지

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEEK = resolve(HERE, "..");
const target = process.argv[2] || "";
const APP = resolve(WEEK, target, "index.html");
const SHOTS = join(HERE, "shots");
const TMP = join(HERE, ".browser-tmp");
const PORT = 9334;
const API_HOST = "wttr.in";
const WEB_PORT = 8606;
const PAGES_PATH = "/QUEST-TRACK-2/week-06/"; // GitHub Pages 주소와 같은 길
const HTTP_APP = `http://127.0.0.1:${WEB_PORT}${PAGES_PATH}`;

// ── 작은 서버: week-06 폴더를 GitHub Pages 처럼 /QUEST-TRACK-2/week-06/ 에서 보여 준다 ──
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
let server = null;
function startServer() {
  return new Promise((ok) => {
    server = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (!path.startsWith(PAGES_PATH)) { res.writeHead(404); return res.end(); }
      let file = resolve(WEEK, "." + path.slice(PAGES_PATH.length - 1));
      if (!file.startsWith(WEEK)) { res.writeHead(403); return res.end(); }
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
      if (!existsSync(file)) { res.writeHead(404); return res.end(); }
      const ext = file.slice(file.lastIndexOf("."));
      res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(readFileSync(file));
    }).listen(WEB_PORT, "127.0.0.1", ok);
  });
}
function stopServer() {
  return new Promise((ok) => {
    if (!server) return ok();
    const s = server; server = null;
    s.closeAllConnections(); s.close(() => ok());
  });
}

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];

// ── 결과 모으기 ──
const ok = [], bad = [];
const pass = (text) => { ok.push(text); console.log("  ✅ " + text); };
const fail = (text) => { bad.push(text); console.log("  ❌ " + text); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(APP)) { console.log("앱 파일이 없어요: " + APP); process.exit(1); }
const browserPath = BROWSERS.find(existsSync);
if (!browserPath) { console.log("Edge 나 Chrome 을 찾지 못했어요."); process.exit(1); }

rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
rmSync(TMP, { recursive: true, force: true });

// ── 브라우저 켜기 ──
const browser = spawn(browserPath, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${TMP}`,
  "--window-size=1280,800", "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });

let ws, nextId = 1;
const waiting = new Map();
const consoleErrors = [];

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, no) => waiting.set(id, { ok, no }));
}
async function js(expr) { // 앱 안에서 코드를 돌리고 결과를 받아 옴
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.data, "base64"));
}

// ── 날씨 서버로 가는 요청을 가로채서 상황을 만든다 ──
// mode: "real" 진짜로 보냄 / "hold" 붙잡아 둠(불러오는 중) / "offline" 인터넷 끊김
//       "500" 서버 오류 / "broken" 이상한 내용 / "mock" 정해 둔 가짜 날씨
let mode = "real";
let mockData = null;
const held = [];
const CORS = [
  { name: "Content-Type", value: "application/json" },
  { name: "Access-Control-Allow-Origin", value: "*" },
];
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

async function onRequest(p) {
  const requestId = p.requestId;
  if (!p.request.url.includes(API_HOST) || mode === "real") return send("Fetch.continueRequest", { requestId });
  if (mode === "hold") { held.push(requestId); return; }
  if (mode === "offline") return send("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" });
  if (mode === "500") return send("Fetch.fulfillRequest", { requestId, responseCode: 500, responseHeaders: CORS, body: b64("서버 오류") });
  if (mode === "broken") return send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: CORS, body: b64("{}") });
  if (mode === "mock") return send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: CORS, body: b64(JSON.stringify(mockData)) });
}

// wttr.in 과 같은 모양의 가짜 날씨 (숫자도 글자로 옴, 관측 시각은 영국 시간)
function fakeWeather(t, code, hi, lo) {
  return {
    current_condition: [{ temp_C: String(t), weatherCode: String(code), observation_time: "06:46 AM" }],
    weather: [{ date: "2026-11-14", maxtempC: String(hi), mintempC: String(lo) }],
  };
}

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((ok) => ws.addEventListener("open", ok));
        ws.addEventListener("message", (e) => {
          const m = JSON.parse(e.data);
          if (m.id && waiting.has(m.id)) {
            const w = waiting.get(m.id); waiting.delete(m.id);
            m.error ? w.no(new Error(m.error.message)) : w.ok(m.result);
          }
          if (m.method === "Fetch.requestPaused") onRequest(m.params).catch(() => {});
          if (m.method === "Runtime.exceptionThrown")
            consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
          if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
            consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
          // 일부러 만든 네트워크 실패는 오류로 세지 않음
          if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && m.params.entry.source !== "network")
            consoleErrors.push(m.params.entry.text + (m.params.entry.url ? " (" + m.params.entry.url + ")" : ""));
        });
        return;
      }
    } catch {}
    await sleep(200);
  }
  throw new Error("브라우저에 연결하지 못했어요.");
}

// 지금 보이는 상태: "loading" / "weather" / "error" / "빈 화면"
const STATE = `(() => {
  const vis = (id) => { const el = document.getElementById(id); return el && !el.hidden && el.offsetHeight > 0; };
  return {
    state: vis("loading") ? "loading" : vis("weather") ? "weather" : vis("error") ? "error" : "빈 화면",
    temp: document.getElementById("now-temp")?.innerText.trim(),
    word: document.getElementById("now-word")?.innerText.trim(),
    high: document.getElementById("high")?.innerText.trim(),
    low: document.getElementById("low")?.innerText.trim(),
    why: document.getElementById("error-why")?.innerText.trim(),
    button: !document.getElementById("reload")?.disabled,
    stale: vis("stale"),
    staleText: document.getElementById("stale")?.innerText.trim(),
    time: document.getElementById("time")?.innerText.trim(),
    dayLabel: document.getElementById("day-label")?.innerText.trim(),
  };
})()`;
async function waitState(want, ms = 12000) {
  const end = Date.now() + ms;
  let s;
  while (Date.now() < end) {
    s = await js(STATE);
    if (s.state === want) return s;
    await sleep(100);
  }
  return s;
}
// keep: 마지막으로 받은 날씨 기억을 남겨 둘지 (기본은 지우고 처음 연 것처럼)
async function openWith(m, { keep = false, url = pathToFileURL(APP).href } = {}) {
  mode = m;
  let id = null;
  if (!keep) id = (await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { localStorage.removeItem("pt-weather-last") } catch (e) {}`,
  })).identifier;
  await send("Page.navigate", { url });
  await sleep(300);
  if (id) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: id });
}
async function setOffline(off) {
  await send("Network.emulateNetworkConditions", { offline: off, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
}
const isTemp = (s) => /^-?\d+°$/.test(s || "");

// ── 확인 순서 ──
try {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  console.log("\n앱: " + APP + "\n");

  // 1. 진짜 인터넷
  console.log("[진짜 날씨 받아 오기]");
  await openWith("real");
  const real = await waitState("weather");
  await shot("1-진짜날씨");
  if (real.state === "weather") {
    pass(`날씨를 받아 와 보여 줌: 지금 ${real.temp} ${real.word}, 가장 높은 ${real.high}, 가장 낮은 ${real.low}`);
    isTemp(real.temp) && isTemp(real.high) && isTemp(real.low) ? pass("기온이 모두 숫자와 ° 로 나옴") : fail(`기온 모양이 이상함: ${real.temp} / ${real.high} / ${real.low}`);
    !real.word.includes("알 수 없는") ? pass("오늘 날씨 번호가 한국어 낱말로 바뀜") : fail("오늘 날씨 번호를 모름: " + real.word);
  } else {
    fail(`날씨를 받아 오지 못함 (화면: ${real.state}${real.why ? ", 까닭: " + real.why : ""})`);
  }

  // 2. 불러오는 중
  console.log("[불러오는 동안]");
  await openWith("hold");
  const hold = await waitState("loading", 3000);
  await shot("2-불러오는중");
  hold.state === "loading" ? pass("답을 기다리는 동안 \"불러오는 중\"이 보임") : fail("기다리는 동안 화면: " + hold.state);
  !hold.button ? pass("불러오는 동안 다시 불러오기 단추가 잠김") : fail("불러오는 동안에도 단추를 누를 수 있음");
  mode = "real";
  for (const id of held.splice(0)) await send("Fetch.continueRequest", { requestId: id }).catch(() => {});

  // 3. 못 받아 왔을 때
  console.log("[못 받아 왔을 때]");
  for (const [m, name, mustHave] of [
    ["offline", "인터넷 끊김", "연결"],
    ["500", "서버 오류", "500"],
    ["broken", "이상한 내용", "빠진"],
  ]) {
    await openWith(m);
    const s = await waitState("error", 5000);
    await shot("3-못받음-" + name);
    if (s.state !== "error") { fail(`${name}: 까닭 대신 화면이 "${s.state}"`); continue; }
    s.why && s.why.includes(mustHave) ? pass(`${name}: 까닭이 보임 — "${s.why}"`) : fail(`${name}: 까닭이 맞지 않음 — "${s.why}"`);
  }

  // 4. 다시 불러오기
  console.log("[다시 불러오기 단추]");
  mockData = fakeWeather(3.4, 113, 9.6, -1.2);
  mode = "mock";
  await js(`document.getElementById("reload").click()`);
  const again = await waitState("weather", 5000);
  const againTime = await js(`document.getElementById("time").innerText`);
  again.state === "weather" && again.temp === "3°" && again.word === "맑음" && again.high === "10°" && again.low === "-1°"
    ? pass("못 받은 뒤 단추를 누르면 다시 받아 와서 보여 줌 (3.4 → 3°, 9.6 → 10°, -1.2 → -1°)")
    : fail(`다시 불러오기 뒤: ${JSON.stringify(again)}`);
  againTime.includes("오늘 15:46") ? pass("관측 시각을 한국 시간으로 바꿈 (06:46 AM → 오늘 15:46)") : fail("관측 시각: " + againTime);

  // 5. 날씨 번호 → 한국어
  console.log("[날씨 번호 바꾸기]");
  const CODES = [113, 116, 119, 122, 143, 176, 179, 182, 185, 200, 227, 230, 248, 260, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308,
    311, 314, 317, 320, 323, 326, 329, 332, 335, 338, 350, 353, 356, 359, 362, 365, 368, 371, 374, 377, 386, 389, 392, 395];
  const words = await js(`${JSON.stringify(CODES)}.map((c) => [c, weatherWord(c)])`);
  const notKo = words.filter(([, w]) => w.includes("알 수 없는") || /[A-Za-z]/.test(w));
  notKo.length ? fail("한국어로 안 바뀐 번호: " + notKo.map(([c]) => c).join(", ")) : pass(`날씨 번호 ${CODES.length}개가 모두 한국어 낱말로 바뀜`);
  const map = Object.fromEntries(words);
  map[113] === "맑음" && map[119] === "흐림" && map[302] === "비" && map[332] === "눈"
    ? pass("113 → 맑음, 119 → 흐림, 302 → 비, 332 → 눈") : fail(`113 → ${map[113]}, 119 → ${map[119]}, 302 → ${map[302]}, 332 → ${map[332]}`);
  const unknown = await js(`weatherWord(42)`);
  unknown.includes("42") ? pass(`모르는 번호도 비우지 않고 알려 줌 (42 → "${unknown}")`) : fail("모르는 번호 42 → " + unknown);

  // 6. 화면 폭
  console.log("[화면 폭]");
  const SIZES = [
    [320, 568, true, "작은 폰"], [390, 844, true, "폰"], [768, 1024, true, "태블릿"],
    [1280, 800, false, "노트북"], [1920, 1080, false, "큰 모니터"],
  ];
  const FIT = `(() => {
    const W = document.documentElement.clientWidth;
    const out = [];
    document.querySelectorAll(".card, .card *").forEach((el) => {
      if (el.offsetParent === null && el.tagName !== "MAIN") return;
      const r = el.getBoundingClientRect();
      if (r.width && (r.left < -0.5 || r.right > W + 0.5)) out.push((el.id || el.className || el.tagName) + " " + Math.round(r.left) + "~" + Math.round(r.right));
    });
    const card = document.querySelector(".card").getBoundingClientRect();
    return { W, scrollW: document.documentElement.scrollWidth, out, card: Math.round(card.width) };
  })()`;
  // 긴 날씨 낱말과 큰 숫자로 시험 (영하 두 자리)
  mockData = fakeWeather(-18, 392, -10, -24);
  for (const [w, h, mobile, name] of SIZES) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    for (const [m, label] of [["mock", "날씨"], ["offline", "못받음"], ["stale", "예전정보"]]) {
      if (m === "stale") { // 한 번 받아 둔 뒤 못 받게 하기
        await openWith("mock"); await waitState("weather", 5000);
        await openWith("offline", { keep: true });
      } else await openWith(m);
      await waitState(m === "offline" ? "error" : "weather", 5000);
      const f = await js(FIT);
      await shot(`6-${name}${w}-${label}`);
      f.scrollW <= f.W && f.out.length === 0
        ? pass(`${name} ${w}×${h} (${label}): 옆으로 밀리거나 잘린 것 없음, 카드 폭 ${f.card}`)
        : fail(`${name} ${w}×${h} (${label}): 페이지 폭 ${f.scrollW} > 화면 ${f.W}, 넘친 것: ${f.out.join(", ") || "없음"}`);
    }
  }

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // 7. 마지막으로 받은 날씨
  console.log("[못 받아 왔을 때 마지막으로 받은 날씨]");
  mockData = fakeWeather(5, 116, 8, 1);
  await openWith("mock");
  await waitState("weather", 5000);
  const saved = await js(`JSON.parse(localStorage.getItem("pt-weather-last") || "null")`);
  saved && saved.nowTemp === 5 && Math.abs(Date.now() - saved.savedAt) < 60000
    ? pass("받아 온 날씨와 받은 때를 기억해 둠") : fail("기억해 둔 것: " + JSON.stringify(saved));
  const whenNow = await js(`whenText(${saved?.savedAt ?? 0})`);
  // (1) 폰이 인터넷 끊김 상태
  await setOffline(true);
  await openWith("offline", { keep: true });
  let st = await waitState("weather", 5000);
  await shot("7-인터넷끊김-예전정보");
  st.state === "weather" && st.stale && st.temp === "5°" && st.word === "구름 조금"
    ? pass("인터넷이 끊기면 빈 화면 대신 마지막으로 받은 날씨(5° 구름 조금)를 보여 줌") : fail("인터넷 끊김: " + JSON.stringify(st));
  st.staleText?.includes("인터넷이 끊겨") && st.staleText.includes(whenNow + "에 받은 정보")
    ? pass(`까닭과 받은 때가 같이 보임 — "${st.staleText.replace(/\n/g, " ")}"`) : fail("안내 글: " + st.staleText);
  st.time?.includes(whenNow + "에 받음") && st.dayLabel === "그날"
    ? pass(`아래 시각도 받은 때로 바뀜 ("${st.time}"), "오늘" 대신 "그날"`) : fail(`시각: ${st.time}, 앞말: ${st.dayLabel}`);
  // (2) 인터넷이 다시 켜지면 저절로 새로 받기
  mockData = fakeWeather(7, 113, 9, 2);
  mode = "mock";
  await setOffline(false);
  await sleep(1500);
  st = await js(STATE);
  st.temp === "7°" && !st.stale && st.dayLabel === "오늘"
    ? pass("인터넷이 다시 켜지면 저절로 새 날씨(7°)를 받고 안내가 사라짐") : fail("다시 켜진 뒤: " + JSON.stringify(st));
  // (3) 인터넷은 되는데 서버가 오류
  await openWith("500", { keep: true });
  st = await waitState("weather", 5000);
  st.stale && st.staleText.includes("500") && st.temp === "7°"
    ? pass("서버 오류 때도 까닭(500)과 마지막 날씨(7°)를 같이 보여 줌") : fail("서버 오류: " + JSON.stringify(st));

  // 8. 폰에 설치되는 앱 (PWA)
  console.log("[폰에 설치되는 앱 (GitHub Pages 와 같은 주소: " + PAGES_PATH + ")]");
  await startServer();
  mockData = fakeWeather(10, 113, 14, 4);
  await openWith("mock", { url: HTTP_APP });
  await waitState("weather", 5000);
  const man = await send("Page.getAppManifest");
  if (!man.url) fail("manifest 를 찾지 못함");
  else {
    man.errors?.length ? fail("manifest 오류: " + man.errors.map((e) => e.message).join(", ")) : pass("manifest 를 읽음 (" + man.url.replace(HTTP_APP, "") + ")");
    const m = JSON.parse(man.data);
    const startUrl = new URL(m.start_url, man.url).href;
    startUrl === HTTP_APP ? pass("시작 주소가 week-06 주소와 같음 (" + PAGES_PATH + ")") : fail("시작 주소: " + startUrl);
    m.display === "standalone" ? pass("설치하면 주소창 없이 앱처럼 열림 (standalone)") : fail("display: " + m.display);
    for (const ic of m.icons) {
      const u = new URL(ic.src, man.url).href;
      const size = await js(`fetch(${JSON.stringify(u)}).then((r) => r.ok ? r.blob() : null).then((b) => b && createImageBitmap(b)).then((im) => im && im.width + "x" + im.height).catch(() => null)`);
      size === ic.sizes ? pass(`아이콘 ${ic.src} (${ic.purpose}) 이 ${size} 크기로 열림`) : fail(`아이콘 ${ic.src}: 기대 ${ic.sizes}, 실제 ${size}`);
    }
  }
  const sw = await js(`Promise.race([navigator.serviceWorker.ready.then((r) => r.scope), new Promise((ok) => setTimeout(() => ok(null), 8000))])`);
  sw === HTTP_APP ? pass("서비스 워커가 켜짐 (범위: " + PAGES_PATH + ")") : fail("서비스 워커: " + sw);
  await send("Page.reload");
  await sleep(300);
  await waitState("weather", 5000);
  const ctl = await js(`!!navigator.serviceWorker.controller`);
  ctl ? pass("다시 열면 서비스 워커가 앱을 맡음") : fail("서비스 워커가 앱을 맡지 않음");
  const cached = await js(`caches.keys().then((k) => Promise.all(k.map((n) => caches.open(n).then((c) => c.keys())))).then((l) => l.flat().map((r) => new URL(r.url).pathname))`);
  const need = ["", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"].map((f) => PAGES_PATH + f);
  const miss = need.filter((p) => !cached.includes(p));
  miss.length ? fail("저장 안 된 앱 파일: " + miss.join(", ")) : pass("앱 파일을 폰에 저장해 둠 (" + cached.length + "개)");
  const inst = await send("Page.getInstallabilityErrors");
  inst.installabilityErrors?.length
    ? fail("설치할 수 없는 까닭: " + inst.installabilityErrors.map((e) => e.errorId).join(", "))
    : pass("브라우저가 '설치할 수 있는 앱'으로 알아봄");
  await shot("8-설치앱-주소로열기");
  // 인터넷이 완전히 끊겼을 때: 서버도 끄고, 날씨 서버도 끊고, 앱을 다시 열기
  await stopServer();
  await setOffline(true);
  await openWith("offline", { keep: true, url: HTTP_APP });
  st = await waitState("weather", 6000);
  await shot("8-설치앱-인터넷끊김");
  st.state === "weather" && st.stale && st.temp === "10°"
    ? pass("서버도 인터넷도 끊긴 채 다시 열어도 앱이 열리고 마지막 날씨(10°)와 받은 때를 보여 줌") : fail("끊긴 채 다시 열기: " + JSON.stringify(st));
  await setOffline(false);

  // 9. 오류
  console.log("[오류 메시지]");
  consoleErrors.length ? consoleErrors.forEach((e) => fail("브라우저 오류: " + e)) : pass("브라우저 오류 메시지 없음");
} catch (e) {
  fail("확인 도중 멈춤: " + e.message);
} finally {
  try { ws?.close(); } catch {}
  await stopServer().catch(() => {});
  browser.kill();
}

console.log(`\n결과: 통과 ${ok.length}개, 실패 ${bad.length}개`);
console.log("사진: " + SHOTS + "  (" + readdirSync(SHOTS).length + "장)");
console.log("이 도구로 확인 못 하는 것: 실제 폰에서 손으로 만졌을 때 느낌, 받아 온 날씨가 창밖 날씨와 맞는지, 10초 기다림 뒤 포기하는 것(시간이 오래 걸려 빼 둠), 진짜 폰 홈 화면에 설치되는 모습(안드로이드 · 아이폰)\n");
process.exit(bad.length ? 1 : 0);
