// 게임 확인 도구
// 쓰는 법 (QUEST-TRACK-2 폴더에서):
//   node week-04/check/check.mjs practice   ← 연습 게임 (week-04/practice/index.html)
//   node week-04/check/check.mjs            ← 내 게임   (week-04/index.html)
// Edge(없으면 Chrome)를 화면 없이 띄워서 게임을 열고, 키를 누르고, 사진을 찍는다.
// 사진은 check/shots/, 브라우저 임시 폴더는 check/.browser-tmp/ 에 생긴다. (둘 다 커밋 안 함)

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEEK = resolve(HERE, "..");
const target = process.argv[2] || "";
const GAME = resolve(WEEK, target, "index.html");
const SHOTS = join(HERE, "shots");
const TMP = join(HERE, ".browser-tmp");
const PORT = 9333;

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

if (!existsSync(GAME)) { console.log("게임 파일이 없어요: " + GAME); process.exit(1); }
const browserPath = BROWSERS.find(existsSync);
if (!browserPath) { console.log("Edge 나 Chrome 을 찾지 못했어요."); process.exit(1); }

rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
rmSync(TMP, { recursive: true, force: true });

// ── 브라우저 켜기 ──
const browser = spawn(browserPath, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${TMP}`,
  "--window-size=960,544", "--autoplay-policy=no-user-gesture-required", "--mute-audio",
  "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });

let ws, nextId = 1;
const waiting = new Map();
const consoleErrors = [];

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, no) => waiting.set(id, { ok, no }));
}
async function js(expr) { // 게임 안에서 코드를 돌리고 결과를 받아 옴
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.data, "base64"));
}
const KEYS = {
  ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, Space: 32, KeyM: 77, Enter: 13,
};
async function key(type, code) {
  const key = code === "Space" ? " " : code.startsWith("Key") ? code.slice(3).toLowerCase() : code;
  await send("Input.dispatchKeyEvent", { type, code, key, windowsVirtualKeyCode: KEYS[code] });
}
async function hold(code, ms) { await key("keyDown", code); await sleep(ms); await key("keyUp", code); }

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
          if (m.method === "Runtime.exceptionThrown")
            consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
          if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
            consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
          if (m.method === "Log.entryAdded" && m.params.entry.level === "error")
            consoleErrors.push(m.params.entry.text + (m.params.entry.url ? " (" + m.params.entry.url + ")" : ""));
        });
        return;
      }
    } catch {}
    await sleep(200);
  }
  throw new Error("브라우저에 연결하지 못했어요.");
}

// ── 길 찾기: 개구리가 갈 수 있는 곳을 모두 따라가 보며 딸기에 닿는지 확인 ──
// 게임의 update() 를 그대로 써서 1/60초씩 움직여 본다.
const REACH_TEST = `(() => {
  const savedMuted = muted; muted = true;
  const DT = 1 / 60;
  const spots = BERRY_SPOTS.map(([c, r]) => ({ x: c * TILE + 8, y: r * TILE + 8, c, r }));
  const got = new Set();
  const save = () => ({ ...player });
  const load = (s) => Object.assign(player, s);
  for (const k in keys) keys[k] = false;

  function step(dir, jump) {
    keys.ArrowLeft = dir < 0; keys.ArrowRight = dir > 0;
    jumpPressed = jump;
    berries = spots.map((s) => ({ x: s.x, y: s.y }));
    clearTimer = 0;
    update(DT);
    spots.forEach((s, i) => { if (!berries.some((b) => b.x === s.x && b.y === s.y)) got.add(i); });
  }
  // 할 수 있는 동작: 걷기, 점프, 2단 점프(누르는 때 여러 가지), 공중에서 방향 바꾸기
  const ACTIONS = [];
  for (const dir of [-1, 0, 1]) {
    ACTIONS.push({ dir, walk: true });
    ACTIONS.push({ dir, jump: true });
    for (const t of [8, 16, 24, 32]) ACTIONS.push({ dir, jump: true, second: t });
    if (dir) ACTIONS.push({ dir, jump: true, second: 16, stopAt: 20 });
  }
  function run(start, a) {
    load(start);
    step(a.walk ? a.dir : 0, !!a.jump);
    for (let f = 1; f < 240; f++) {
      const dir = a.stopAt && f >= a.stopAt ? 0 : a.dir;
      step(dir, a.second === f);
      if (a.walk && f >= 6 && player.onGround) break;
      if (!a.walk && player.onGround) break;
    }
    return player.onGround ? save() : null;
  }
  // 시작 자리에서 땅에 닿을 때까지 떨어뜨림
  load({ ...player, vx: 0, vy: 0 });
  for (let f = 0; f < 120 && !player.onGround; f++) step(0, false);
  const first = save();
  const seen = new Set(), queue = [first];
  const keyOf = (p) => Math.round(p.x / 4) + "," + Math.round(p.y);
  seen.add(keyOf(first));
  while (queue.length && seen.size < 5000) {
    const s = queue.shift();
    for (const a of ACTIONS) {
      const n = run(s, a);
      if (!n) continue;
      const k = keyOf(n);
      if (!seen.has(k)) { seen.add(k); queue.push(n); }
    }
  }
  // 원래대로 돌려놓기
  load(first);
  for (const k in keys) keys[k] = false;
  jumpPressed = false; muted = savedMuted; score = 0; clearTimer = 0;
  spawnBerries();
  const missed = spots.filter((s, i) => !got.has(i)).map((s) => "(" + s.c + ", " + s.r + ")");
  return { total: spots.length, got: got.size, missed, places: seen.size };
})()`;

// ── 확인 순서 ──
try {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  console.log("\n게임: " + GAME + "\n");

  // 1. 열기
  console.log("[열기]");
  await send("Page.navigate", { url: pathToFileURL(GAME).href });
  await sleep(1500);
  await shot("1-처음화면");
  const msgText = await js(`document.getElementById("msg")?.innerText || ""`);
  if (msgText.includes("못 불러왔어요")) fail("그림 불러오기: " + msgText);
  else pass("파일을 두 번 눌러 연 것처럼 file:// 로 열림");

  // 2. 그림
  console.log("[그림]");
  const img = await js(`(() => {
    const out = {};
    if (typeof images === "undefined") return null;
    for (const [k, im] of Object.entries(images)) out[k] = im.complete && im.naturalWidth > 0 ? im.naturalWidth + "x" + im.naturalHeight : "실패";
    return out;
  })()`);
  if (!img) fail("images 를 찾지 못함 (그림 확인 건너뜀)");
  else {
    const broken = Object.entries(img).filter(([, v]) => v === "실패");
    broken.length ? fail("불러오지 못한 그림: " + broken.map(([k]) => k).join(", "))
                  : pass(`그림 ${Object.keys(img).length}개 모두 불러옴`);
  }
  const smooth = await js(`document.querySelector("canvas")?.getContext("2d").imageSmoothingEnabled`);
  smooth === false ? pass("픽셀 아트를 흐리지 않게 그림 (imageSmoothingEnabled = false)")
                   : fail("imageSmoothingEnabled 가 false 가 아님 → 그림이 흐릴 수 있음");

  // 3. 소리 파일
  console.log("[소리 파일]");
  await sleep(500);
  const snd = await js(`(() => {
    if (typeof sounds === "undefined") return null;
    const out = {};
    for (const [k, a] of Object.entries(sounds)) out[k] = a.error ? "실패" : a.readyState >= 2 ? Math.round(a.duration * 100) / 100 + "초" : "아직 안 불러옴";
    return out;
  })()`);
  if (!snd) fail("sounds 를 찾지 못함 (소리 확인 건너뜀)");
  else for (const [k, v] of Object.entries(snd))
    v.endsWith("초") ? pass(`소리 ${k}: 불러옴 (${v})`) : fail(`소리 ${k}: ${v}`);

  // 4. 시작하고 움직여 보기
  console.log("[움직이기]");
  await key("keyDown", "Enter"); await key("keyUp", "Enter");
  await sleep(600);
  await shot("2-시작");
  const bgm = await js(`typeof sounds !== "undefined" && sounds.bgm ? { paused: sounds.bgm.paused, loop: sounds.bgm.loop } : null`);
  if (bgm) {
    bgm.paused ? fail("배경음악이 재생되지 않음") : pass("키를 누르면 배경음악이 재생됨");
    bgm.loop ? pass("배경음악 반복(loop) 켜짐") : fail("배경음악 반복(loop) 꺼짐");
  }
  const p0 = await js(`({ x: player.x, y: player.y, anim: player.anim })`);
  await key("keyDown", "ArrowRight");
  await sleep(300);
  await shot("3-달리기");
  const runAnim = await js(`player.anim`);
  await sleep(200);
  await key("keyUp", "ArrowRight");
  const p1 = await js(`({ x: player.x, y: player.y })`);
  p1.x > p0.x ? pass(`→ 를 누르면 오른쪽으로 감 (${Math.round(p0.x)} → ${Math.round(p1.x)})`) : fail("→ 를 눌러도 안 움직임");
  runAnim === "run" ? pass("달릴 때 달리기 애니메이션") : fail("달릴 때 애니메이션이 " + runAnim);
  await hold("ArrowLeft", 250);
  const p2 = await js(`player.x`);
  p2 < p1.x ? pass("← 를 누르면 왼쪽으로 감") : fail("← 를 눌러도 안 움직임");
  await sleep(300);
  const idleAnim = await js(`player.anim`);
  idleAnim === "idle" ? pass("멈추면 대기 애니메이션") : fail("멈췄는데 애니메이션이 " + idleAnim);

  // 5. 점프
  console.log("[점프]");
  const groundY = await js(`player.y`);
  await hold("Space", 50);
  await sleep(120);
  const jumpState = await js(`({ y: player.y, anim: player.anim })`);
  await shot("4-점프");
  jumpState.y < groundY ? pass("스페이스를 누르면 뛰어오름") : fail("스페이스를 눌러도 안 뜀");
  jumpState.anim === "jump" ? pass("올라갈 때 점프 애니메이션") : fail("올라갈 때 애니메이션이 " + jumpState.anim);
  await hold("Space", 50);
  await sleep(60);
  const dj = await js(`player.anim`);
  await shot("5-2단점프");
  dj === "double-jump" ? pass("공중에서 한 번 더 누르면 2단 점프 애니메이션") : fail("2단 점프 애니메이션이 아님: " + dj);
  // 사진 찍는 데 시간이 걸리므로, 떨어짐은 짧게 자주 들여다보며 기다림
  let fallSeen = false;
  for (let i = 0; i < 60 && !fallSeen; i++) {
    const s = await js(`({ anim: player.anim, vy: player.vy, onGround: player.onGround })`);
    if (s.onGround) break;
    if (s.vy > 0) { fallSeen = s.anim === "fall"; if (!fallSeen) { fail("내려올 때 애니메이션이 " + s.anim); break; } }
    else await sleep(20);
  }
  if (fallSeen) { await shot("6-떨어짐"); pass("내려올 때 떨어짐 애니메이션"); }
  else if (!bad.some((b) => b.startsWith("내려올 때"))) fail("내려오는 모습을 보지 못함");
  await sleep(1200);
  (await js(`player.onGround`)) ? pass("다시 땅에 내려옴") : fail("땅에 내려오지 않음");

  // 6. 길 찾기
  console.log("[갈 수 있는 곳]");
  const reach = await js(REACH_TEST);
  reach.got === reach.total
    ? pass(`시작 자리에서 딸기 ${reach.total}개 모두에 닿을 수 있음 (서 볼 수 있는 자리 ${reach.places}곳)`)
    : fail(`딸기 ${reach.total}개 중 ${reach.got}개만 닿음. 못 닿는 칸(가로, 세로): ${reach.missed.join(" ")}`);

  // 7. 딸기 먹기와 다시 나오기
  console.log("[딸기]");
  const eat = await js(`(() => {
    muted = true;
    const n = berries.length;
    for (const b of [...berries]) { player.x = b.x - player.w / 2; player.y = b.y - player.h / 2; player.vy = 0; update(1 / 60); }
    const after = berries.length, sc = score;
    player.x = 40; player.y = 200; player.vy = 0; // 딸기가 다시 나올 때 바로 먹지 않게 시작 자리로
    for (let i = 0; i < 120; i++) update(1 / 60);
    const back = berries.length;
    muted = false;
    return { n, after, sc, back };
  })()`);
  eat.after === 0 && eat.sc === eat.n ? pass(`딸기에 닿으면 사라지고 점수가 오름 (${eat.n}개 → 점수 ${eat.sc})`) : fail(`딸기 먹기 이상: 남은 ${eat.after}, 점수 ${eat.sc}`);
  eat.back === eat.n ? pass("다 모으면 딸기가 다시 나옴") : fail(`다 모은 뒤 딸기가 ${eat.back}개만 다시 나옴`);
  await sleep(100);
  await shot("7-다모음");
  const hudText = await js(`document.getElementById("hud")?.innerText`);
  console.log("     (점수판 글자: " + hudText + ")");

  // 8. 소리 끄기
  console.log("[소리 끄기]");
  await hold("KeyM", 50);
  const m1 = await js(`({ muted, bgm: sounds.bgm.muted })`);
  await hold("KeyM", 50);
  const m2 = await js(`({ muted, bgm: sounds.bgm.muted })`);
  m1.muted && m1.bgm && !m2.muted && !m2.bgm ? pass("M 으로 소리가 꺼지고 다시 켜짐") : fail("M 소리 끄기/켜기가 이상함");

  // 9. 창 크기
  console.log("[창 크기]");
  for (const [w, h] of [[640, 400], [1440, 900]]) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const c = await js(`(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
    await shot(`8-창${w}x${h}`);
    c.w <= w && c.h <= h ? pass(`창 ${w}×${h}: 게임 화면 ${c.w}×${c.h} 로 창 안에 들어감`) : fail(`창 ${w}×${h}: 게임 화면 ${c.w}×${c.h} 가 창보다 큼`);
  }

  // 10. 오류
  console.log("[오류 메시지]");
  consoleErrors.length ? consoleErrors.forEach((e) => fail("브라우저 오류: " + e)) : pass("브라우저 오류 메시지 없음");
} catch (e) {
  fail("확인 도중 멈춤: " + e.message);
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
}

console.log(`\n결과: 통과 ${ok.length}개, 실패 ${bad.length}개`);
console.log("사진: " + SHOTS + "  (" + readdirSync(SHOTS).length + "장)");
console.log("이 도구로 확인 못 하는 것: 소리가 실제로 귀에 어떻게 들리는지, 배경음악이 반복될 때 끊기는 느낌, 조작 손맛\n");
process.exit(bad.length ? 1 : 0);
