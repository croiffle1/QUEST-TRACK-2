// 게임 확인 도구
// 쓰는 법 (QUEST-TRACK-2 폴더에서):
//   node week-05/check/check.mjs            ← 내 게임 (week-05/index.html)
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

// ── 게임 창구: 게임에 window.CHECK 가 있으면 그걸 쓰고, 없으면 연습 게임(딸기) 이름을 씀 ──
const ADAPTER = `window.__G = window.CHECK || {
  name: "딸기",
  items: () => berries, setItems: (v) => { berries = v; }, respawn: () => spawnBerries(),
  spots: BERRY_SPOTS, count: BERRY_COUNT, doubleJump: true,
  setHazards: () => {}, hazards: () => [], state: null,
}; true`;

// ── 길 찾기: 캐릭터가 갈 수 있는 곳을 모두 따라가 보며 아이템 자리에 닿는지 확인 ──
// 게임의 update() 를 그대로 써서 1/60초씩 움직여 본다.
const REACH_TEST = `(() => {
  const savedMuted = muted; muted = true;
  __G.setHazards(false);
  const DT = 1 / 60;
  const spots = __G.spots.map(([c, r]) => ({ x: c * TILE + 8, y: r * TILE + 8, c, r }));
  const got = new Set();
  const save = () => ({ ...player });
  const load = (s) => Object.assign(player, s);
  for (const k in keys) keys[k] = false;

  // 아이템이 놓일 수 있는 자리 하나하나에 몸이 닿는지 본다. 닿는 판정은 연습 게임과 같은 식
  function step(dir, jump) {
    keys.ArrowLeft = dir < 0; keys.ArrowRight = dir > 0;
    jumpPressed = jump;
    __G.setItems([{ x: -999, y: -999 }]);
    if (typeof clearTimer !== "undefined") clearTimer = 0;
    update(DT);
    const cx = player.x + player.w / 2, cy = player.y + player.h / 2;
    spots.forEach((s, i) => {
      if (Math.abs(s.x - cx) < player.w / 2 + 6 && Math.abs(s.y - cy) < player.h / 2 + 6) got.add(i);
    });
  }
  // 할 수 있는 동작: 걷기, 점프, 2단 점프(누르는 때 여러 가지), 공중에서 방향 바꾸기
  const ACTIONS = [];
  for (const dir of [-1, 0, 1]) {
    ACTIONS.push({ dir, walk: true });
    ACTIONS.push({ dir, jump: true });
    if (__G.doubleJump) for (const t of [8, 16, 24, 32]) ACTIONS.push({ dir, jump: true, second: t });
    if (dir) ACTIONS.push({ dir, jump: true, second: __G.doubleJump ? 16 : 0, stopAt: 20 });
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
  jumpPressed = false; muted = savedMuted; score = 0;
  if (typeof clearTimer !== "undefined") clearTimer = 0;
  __G.respawn();
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
  await js(ADAPTER);
  const NAME = await js(`__G.name`);
  await shot("1-처음화면");
  const msgText = await js(`document.getElementById("msg")?.innerText || ""`);
  if (msgText.includes("못 불러왔어요")) fail("그림 불러오기: " + msgText);
  else pass("파일을 두 번 눌러 연 것처럼 file:// 로 열림");

  // 1-1. 아이템 자리: 개수, 땅 속에 묻히지 않았는지, 다시 열면 자리가 바뀌는지
  console.log(`[${NAME} 자리]`);
  const ITEM_INFO = `(() => {
    const items = __G.items();
    const pos = items.map((b) => b.x + "," + b.y);
    const buried = items.filter((b) => isSolid(Math.floor(b.x / TILE), Math.floor(b.y / TILE))).length;
    return { pos, buried, want: __G.count };
  })()`;
  const b1 = await js(ITEM_INFO);
  b1.pos.length === b1.want
    ? pass(`${NAME} ${b1.pos.length}개가 나옴`) : fail(`${NAME}가 ${b1.want}개가 아니라 ${b1.pos.length}개 나옴`);
  b1.buried === 0 ? pass(`땅 속에 묻힌 ${NAME} 없음`) : fail(`땅 속에 묻힌 ${NAME} ${b1.buried}개`);
  await send("Page.reload");
  await sleep(1500);
  await js(ADAPTER);
  await shot("1-다시열기");
  const b2 = await js(ITEM_INFO);
  const same = b2.pos.filter((p) => b1.pos.includes(p)).length;
  if (await js(`!!__G.fixedItems`)) console.log(`     (${NAME} 자리가 맵에 정해진 게임이라 "다시 열면 자리가 바뀜"은 건너뜀)`);
  else same < b2.pos.length
    ? pass(`다시 열면 ${NAME} 자리가 바뀜 (${b2.pos.length}개 중 ${same}개만 같은 자리)`)
    : fail(`다시 열어도 ${NAME} 자리가 그대로임`);
  const START = await js(`({ x: player.x, y: player.y })`);
  await js(`__G.setHazards(false)`); // 움직임을 보는 동안은 적에 부딪혀도 안 다치게

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
  await js(`(() => { player.x = ${START.x}; player.vx = 0; })()`); // 머리 위가 트인 시작 자리에서 뛰어 봄
  await sleep(500);
  const groundY = await js(`player.y`);
  await hold("Space", 160); // 짧게 누르면 낮게 뛰는 게임도 있어서 사람처럼 조금 길게 누름
  await sleep(40);
  const jumpState = await js(`({ y: player.y, anim: player.anim })`);
  await shot("4-점프");
  jumpState.y < groundY ? pass("스페이스를 누르면 뛰어오름") : fail("스페이스를 눌러도 안 뜀");
  jumpState.anim === "jump" ? pass("올라갈 때 점프 애니메이션") : fail("올라갈 때 애니메이션이 " + jumpState.anim);
  if (await js(`__G.doubleJump`)) {
    await hold("Space", 50);
    await sleep(60);
    const dj = await js(`player.anim`);
    await shot("5-2단점프");
    dj === "double-jump" ? pass("공중에서 한 번 더 누르면 2단 점프 애니메이션") : fail("2단 점프 애니메이션이 아님: " + dj);
  } else console.log("     (이 게임은 2단 점프가 없어서 건너뜀)");
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
  // 스테이지가 여러 개면 스테이지마다 확인 (자리 = 금화 + 물약 + 출구)
  const stageCount = await js(`__G.stages || 1`);
  for (let s = 0; s < stageCount; s++) {
    if (stageCount > 1) await js(`(() => { __G.setStage(${s}); __G.setHazards(false); })()`);
    const label = stageCount > 1 ? `스테이지 ${s + 1}: ` : "";
    const reach = await js(REACH_TEST);
    reach.got === reach.total
      ? pass(`${label}시작 자리에서 ${NAME}가 놓일 수 있는 자리 ${reach.total}곳 모두에 닿을 수 있음 (서 볼 수 있는 자리 ${reach.places}곳)`)
      : fail(`${label}${NAME}가 놓일 수 있는 자리 ${reach.total}곳 중 ${reach.got}곳만 닿음. 못 닿는 칸(가로, 세로): ${reach.missed.join(" ")}`);
  }
  if (stageCount > 1) await js(`(() => { __G.setStage(0); __G.setHazards(false); })()`);

  // 7. 아이템 먹기와 다시 나오기
  console.log(`[${NAME}]`);
  const eat = await js(`(() => {
    muted = true;
    const list = [...__G.items()], n = list.length, sc0 = score;
    let gone = 0;
    for (const b of list) {
      // 몸이 땅에 묻히면 게임이 밀어내므로, 아이템에 닿으면서 땅에는 안 묻히는 자리를 찾아 놓음
      player.y = b.y + 6 - player.h; player.vy = 0;
      for (const dx of [0, -2, 2, -4, 4, -6, 6]) {
        player.x = b.x - player.w / 2 + dx;
        if (!overlapsSolid(player.x, player.y, player.w, player.h)) break;
      }
      update(1 / 60);
      if (!__G.items().includes(b)) gone++;
    }
    const sc = score - sc0;
    player.x = ${START.x}; player.y = ${START.y}; player.vy = 0; // 다시 나올 때 바로 먹지 않게 시작 자리로
    for (let i = 0; i < 120; i++) update(1 / 60);
    const back = __G.items().length;
    muted = false;
    return { n, gone, sc, back };
  })()`);
  eat.gone === eat.n && eat.sc === eat.n ? pass(`${NAME}에 닿으면 사라지고 점수가 오름 (${eat.n}개 → 점수 +${eat.sc})`) : fail(`${NAME} 먹기 이상: 사라진 것 ${eat.gone}개, 점수 +${eat.sc}`);
  if (await js(`!!__G.fixedItems`)) {
    eat.back === 0 ? pass(`먹은 ${NAME}는 다시 나오지 않음 (자리가 정해진 게임)`) : fail(`먹은 ${NAME}가 ${eat.back}개 다시 나옴`);
  } else eat.back === eat.n ? pass(`먹은 뒤 ${NAME}가 다시 ${eat.back}개 나옴`) : fail(`먹은 뒤 ${NAME}가 ${eat.back}개만 다시 나옴`);
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

  // 8-1. 적 (게임에 state 가 있을 때만): 부딪히면 목숨이 줄고, 잠깐 무적, 목숨이 다 떨어지면 게임 끝, 키로 다시 시작
  if (await js(`!!__G.state && __G.hazards().length > 0`)) {
    console.log("[적]");
    await js(`__G.setHazards(true)`);
    const hz = await js(`(() => {
      muted = true;
      const touch = () => { const b = __G.hazards()[0]; player.x = b.x - player.w / 2; player.y = b.y - player.h / 2; player.vy = 0; update(1 / 60); };
      const s0 = __G.state();
      touch();
      const s1 = __G.state(), anim1 = player.anim;
      touch();
      const s2 = __G.state();
      muted = false;
      return { s0, s1, anim1, s2 };
    })()`);
    hz.s1.lives === hz.s0.lives - 1 ? pass(`적에 닿으면 목숨이 줄어듦 (${hz.s0.lives} → ${hz.s1.lives})`) : fail(`적에 닿았는데 목숨이 ${hz.s0.lives} → ${hz.s1.lives}`);
    hz.anim1 === "hit" ? pass("맞으면 피격 애니메이션") : fail("맞았을 때 애니메이션이 " + hz.anim1);
    hz.s2.lives === hz.s1.lives ? pass("맞은 직후에는 잠깐 무적이라 또 줄지 않음") : fail("맞은 직후 또 목숨이 줄어듦");
    await sleep(150);
    await shot("9-맞음");
    const over = await js(`(() => {
      muted = true;
      lives = 1; invincible = 0; hitTimer = 0;
      const b = __G.hazards()[0]; player.x = b.x - player.w / 2; player.y = b.y - player.h / 2; player.vy = 0;
      for (let i = 0; i < 60; i++) update(1 / 60);
      muted = false;
      return { ...__G.state(), msg: document.getElementById("msg").innerText };
    })()`);
    over.gameOver && over.lives === 0 ? pass("목숨이 다 떨어지면 게임 끝 화면이 나옴") : fail("목숨이 0이 돼도 게임이 끝나지 않음");
    console.log("     (게임 끝 글자: " + over.msg.replace(/\n+/g, " / ") + ")");
    await sleep(100);
    await shot("10-게임끝");
    await sleep(900);
    await key("keyDown", "Enter"); await key("keyUp", "Enter");
    await sleep(200);
    const again = await js(`({ ...__G.state(), items: __G.items().length })`);
    !again.gameOver && again.score === 0 && again.lives > 0
      ? pass(`키를 누르면 처음부터 다시 시작 (목숨 ${again.lives}, 점수 0, ${NAME} ${again.items}개)`)
      : fail("게임 끝에서 키를 눌러도 다시 시작하지 않음");
  }

  // 8-2. 스테이지 게임 (게임에 stages 가 있을 때만): 손맛 장치, 구덩이, 체크포인트, 밟기, 예고, 출구
  if (await js(`!!__G.stages`)) {
    console.log("[스테이지와 손맛]");
    const st = await js(`(() => {
      muted = true;
      const out = {};
      const run = (n) => { for (let i = 0; i < n; i++) update(1 / 60); };
      const fresh = (s) => { __G.setStage(s); lives = 3; gameOver = false; invincible = 0; hitTimer = 0;
                             for (const k in keys) keys[k] = false; jumpPressed = false; };
      __G.setHazards(true);

      __G.setStage(0); out.startInv = invincible;

      // 입력 버퍼: 땅에 닿기 직전에 눌러도 닿자마자 뜀 (손맛만 보려고 몹·함정은 잠깐 끔)
      __G.setHazards(false);
      fresh(0); run(60);
      player.y -= 12; player.vy = 120; player.onGround = false; coyote = 0;
      jumpPressed = true; out.buffer = false;
      for (let i = 0; i < 20 && !out.buffer; i++) { update(1 / 60); if (player.vy < -200) out.buffer = true; }

      // 코요테 타임: 땅 끝에서 걸어 나가 떨어지기 시작한 뒤 3프레임 뒤에 눌러도 뜀
      fresh(0);
      let edge = 0; while (isSolid(edge + 1, 15)) edge++;
      player.x = edge * TILE; player.y = 15 * TILE - player.h; player.vy = 0; run(2);
      keys.ArrowRight = true;
      for (let f = 0; f < 60 && player.onGround; f++) update(1 / 60);
      run(3); keys.ArrowRight = false;
      jumpPressed = true; update(1 / 60);
      out.coyote = player.vy < -200;
      __G.setHazards(true);

      // 구덩이: 빠지면 목숨 -1, 체크포인트(처음엔 시작 자리)로 돌아옴
      fresh(0);
      const l0 = lives;
      player.x = (edge + 2) * TILE; player.y = 15 * TILE; player.vy = 100;
      run(90);
      out.pit = { l0, l1: lives, back: Math.abs(player.x - respawnAt.x) < 1 && player.y < 15 * TILE, inv: invincible > 0 };

      // 체크포인트
      fresh(0);
      const g = graves[0];
      player.x = g.x; player.y = g.y + 16 - player.h; player.vy = 0; update(1 / 60);
      out.checkpoint = g.on && respawnAt.x === g.x;

      // 슬라임 밟기
      fresh(0);
      const sl = enemies.find((e) => e.kind === "slime");
      const lb = lives;
      const slTop = typeof enemyBox === "function" ? enemyBox(sl).y : sl.y - 10;
      player.x = sl.x - player.w / 2; player.y = slTop - 2 - player.h; player.vy = 200; player.onGround = false;
      run(3);
      out.stomp = { dead: !sl.alive, safe: lives === lb, bounce: player.vy < 0 };

      // 유령은 밟아도 다침
      fresh(1);
      const gh = enemies.find((e) => e.kind === "ghost");
      const lg = lives;
      player.x = gh.x - player.w / 2; player.y = gh.y - 7 - player.h + 3; player.vy = 200; update(1 / 60);
      out.ghost = lives === lg - 1 && gh.alive;

      // 떨어지는 철퇴: 먼저 예고하고, 그다음 떨어짐
      fresh(2);
      const d = balls.find((b) => b.type === "drop");
      player.x = d.x - player.w / 2; player.y = 15 * TILE - player.h; player.vy = 0;
      update(1 / 60); out.warn1 = d.state;
      run(20); out.warn2 = d.state; out.still = d.y === d.homeY;
      run(40); out.fell = d.y > d.homeY;

      // 대시 (게임에 있을 때만)
      if (typeof DASH_TIME !== "undefined") {
        // 땅에서 대시하면 걷기보다 훨씬 멀리 감
        fresh(0); run(30);
        let x0 = player.x; dashPressed = true; run(12);
        out.dashDist = Math.round(player.x - x0);
        out.walkDist = Math.round(SPEED * 12 / 60);
        // 대시 중에는 철퇴에 닿아도 안 다침
        fresh(0); run(30);
        const ball = balls.find((b) => b.type === "roll");
        dashPressed = true; update(1 / 60);
        const ld = lives;
        player.x = ball.x - player.w / 2; player.y = ball.y - player.h / 2; update(1 / 60);
        out.dashSafe = lives === ld;
        // 공중에서는 한 번만: 대시가 끝나고 쿨타임이 지나도 땅에 닿기 전에는 다시 못 함
        fresh(0); run(30);
        player.y -= 100; player.vy = 0; player.onGround = false;
        dashPressed = true; update(1 / 60);
        const first = dashTime > 0;
        dashTime = 0; dashCool = 0; dashPressed = true; update(1 / 60);
        out.airOnce = first && dashTime <= 0;
      }

      // 싸우기 (게임에 공격이 있을 때만)
      if (typeof attackBox === "function") {
        const arrows = () => shots.filter((s) => s.kind === "arrow").length;
        // 할퀴기로 슬라임(체력 1) 무찌르기 → 금화를 떨어뜨림
        fresh(0);
        const s1 = enemies.find((e) => e.kind === "slime");
        player.x = s1.x - 14 - player.w; player.y = 15 * TILE - player.h; player.vy = 0; player.facing = 1;
        const near = () => coins.some((k) => Math.abs(k.x - s1.x) < 12 && Math.abs(k.y - s1.y) < 12);
        const had = near();
        attackPressed = true; run(2);
        out.atkSlime = { dead: !s1.alive, coin: !had && near(), safe: lives === 3 };
        // 유령(체력 2): 한 번 맞으면 체력만 줄고, 두 번 맞으면 무찌름
        fresh(1); __G.setHazards(false);
        const g2 = enemies.find((e) => e.kind === "ghost");
        const swing = () => { player.x = g2.x - 14 - player.w; player.y = g2.y - player.h / 2; player.vy = 0; player.facing = 1;
                              attackCool = 0; attackPressed = true; update(1 / 60); update(1 / 60); };
        swing(); const hp1 = g2.hp, alive1 = g2.alive; run(20); swing();
        out.ghost2 = { hp1, alive1, dead: !g2.alive };
        // 불덩이는 할퀴면 사라짐
        fresh(3);
        player.facing = 1;
        shots = [{ kind: "fire", x: player.x + player.w + 10, y: player.y + 10, vx: -40, vy: 0, w: 9, h: 9, life: 3 }];
        attackPressed = true; update(1 / 60);
        out.deflect = shots.length === 0;
        __G.setHazards(true);
        // 외눈 거인: 빨개진 채로 제자리에서 기다렸다가(windup) 돌진
        fresh(3); invincible = 99;
        const og = enemies.find((e) => e.kind === "ogre"); og.cool = 0;
        player.x = og.x + 70; player.y = 15 * TILE - player.h; player.vy = 0;
        update(1 / 60); out.ogre1 = og.state; const ox = og.x;
        run(20); out.ogre2 = og.state; out.ogreStill = Math.abs(og.x - ox) < 0.5;
        run(30); out.ogre3 = og.state;
        // 마법사: 손이 빛나는 동안(cast)은 안 쏘고, 그다음 불덩이
        fresh(3); invincible = 99;
        const mg = enemies.find((e) => e.kind === "mage"); mg.timer = 0;
        player.x = mg.x - 100; player.y = 15 * TILE - player.h; player.vy = 0;
        update(1 / 60); out.mage1 = mg.state;
        run(30); out.mageWait = !shots.some((s) => s.kind === "fire");
        run(30); out.mageFire = shots.some((s) => s.kind === "fire");
        // 가고일: 눈이 빨개진 뒤(warn) 화살
        fresh(2); invincible = 99;
        const ga = gargoyles[0]; ga.timer = 0; ga.state = "idle";
        player.x = ga.x - 120; player.y = 15 * TILE - player.h; player.vy = 0;
        update(1 / 60); out.garg1 = ga.state;
        run(20); out.gargWait = arrows() === 0;
        run(30); out.gargFire = arrows() > 0;
        // 솟는 가시: 내려가 있음 → 덜컹(warn) → 솟음(up)
        fresh(1); invincible = 99;
        const pp = pops[0], seq = [];
        for (let i = 0; i < 240; i++) { update(1 / 60); invincible = 99; if (seq[seq.length - 1] !== pp.state) seq.push(pp.state); }
        out.pops = seq.join(">");
        // 보스: 쓰러뜨리기 전에는 보물상자가 잠겨 있음
        fresh(4); invincible = 99;
        out.bossHas = !!boss; out.locked = exit.locked;
        player.x = exit.x; player.y = exit.y + 16 - player.h; player.vy = 0; update(1 / 60);
        out.lockedPhase = phase;
        // 보스 공격 순서: 예고(windup / crouch / roar) 바로 뒤에만 공격(charge / leap / 바위)
        fresh(4);
        player.x = boss.x - 200; player.y = 15 * TILE - player.h; player.vy = 0;
        const bseq = [];
        for (let i = 0; i < 60 * 14 && boss; i++) { invincible = 99; update(1 / 60); if (boss && bseq[bseq.length - 1] !== boss.state) bseq.push(boss.state); }
        out.bossSeq = bseq.join(">");
        // 보스를 할퀴어서 쓰러뜨리면 보물상자가 열림
        let swings = 0;
        while (boss && boss.hp > 0 && swings < 300) {
          invincible = 99;
          player.x = boss.x - boss.w / 2 - player.w - 4; player.y = boss.y - player.h; player.vy = 0; player.facing = 1;
          attackCool = 0; attackPressed = true; run(4); swings++;
        }
        out.bossSwings = swings;
        run(150);
        out.bossGone = !boss; out.unlocked = !exit.locked;
      }
      muted = false;
      return out;
    })()`);
    st.startInv > 0.5 ? pass(`스테이지가 시작되면 ${st.startInv}초 동안 무적 (시작 직후 보호)`) : fail("스테이지 시작 직후 무적이 없음");
    st.buffer ? pass("땅에 닿기 직전에 누른 점프도 닿자마자 뜀 (입력 버퍼)") : fail("땅에 닿기 직전에 누른 점프가 무시됨");
    st.coyote ? pass("땅 끝에서 떨어지기 시작한 직후에 눌러도 점프됨 (코요테 타임)") : fail("땅 끝에서 막 떨어진 뒤 점프가 안 됨");
    st.pit.l1 === st.pit.l0 - 1 && st.pit.back && st.pit.inv
      ? pass(`구덩이에 빠지면 목숨 -1 (${st.pit.l0} → ${st.pit.l1}), 체크포인트로 돌아오고 잠깐 무적`)
      : fail(`구덩이 이상: 목숨 ${st.pit.l0} → ${st.pit.l1}, 돌아옴 ${st.pit.back}, 무적 ${st.pit.inv}`);
    st.checkpoint ? pass("묘비에 닿으면 체크포인트가 켜지고 다시 시작할 자리가 바뀜") : fail("묘비 체크포인트가 켜지지 않음");
    st.stomp.dead && st.stomp.safe && st.stomp.bounce ? pass("슬라임을 위에서 밟으면 슬라임이 사라지고 여우는 튀어 오름, 목숨 그대로")
      : fail(`슬라임 밟기 이상: 사라짐 ${st.stomp.dead}, 목숨 그대로 ${st.stomp.safe}, 튀어 오름 ${st.stomp.bounce}`);
    st.ghost ? pass("유령은 위에서 밟아도 다침 (밟을 수 없는 적)") : fail("유령을 밟았는데 다치지 않음");
    st.warn1 === "warn" && st.warn2 === "warn" && st.still && st.fell
      ? pass("떨어지는 철퇴는 먼저 0.7초 동안 흔들리고 땅에 빨간 표시를 한 뒤 떨어짐 (공격 예고)")
      : fail(`철퇴 예고 이상: ${st.warn1} → ${st.warn2}, 제자리 ${st.still}, 떨어짐 ${st.fell}`);
    if (st.dashDist !== undefined) {
      st.dashDist > st.walkDist * 1.8 ? pass(`대시하면 0.2초 동안 ${st.dashDist}px 감 (걸으면 ${st.walkDist}px)`) : fail(`대시 거리 ${st.dashDist}px 가 걷기 ${st.walkDist}px 와 별 차이 없음`);
      st.dashSafe ? pass("대시하는 동안은 철퇴에 닿아도 안 다침 (피하기 기술)") : fail("대시 중에 철퇴에 맞음");
      st.airOnce ? pass("공중 대시는 땅에 닿기 전까지 한 번만") : fail("공중에서 대시가 여러 번 됨 (또는 첫 대시가 안 됨)");
    }
    if (st.atkSlime) {
      console.log("[싸우기와 함정 예고]");
      st.atkSlime.dead && st.atkSlime.coin && st.atkSlime.safe ? pass("Z 로 할퀴면 슬라임이 쓰러지고 금화를 떨어뜨림")
        : fail(`할퀴기 이상: 쓰러짐 ${st.atkSlime.dead}, 금화 ${st.atkSlime.coin}, 목숨 그대로 ${st.atkSlime.safe}`);
      st.ghost2.alive1 && st.ghost2.hp1 === 1 && st.ghost2.dead ? pass("유령은 체력 2: 한 번 할퀴면 버티고, 두 번이면 쓰러짐")
        : fail(`유령 체력 이상: 첫 번째 뒤 체력 ${st.ghost2.hp1}, 살아 있음 ${st.ghost2.alive1}, 두 번째 뒤 쓰러짐 ${st.ghost2.dead}`);
      st.deflect ? pass("날아오는 불덩이를 할퀴면 사라짐 (튕겨냄)") : fail("불덩이를 할퀴어도 안 사라짐");
      st.ogre1 === "windup" && st.ogre2 === "windup" && st.ogreStill && (st.ogre3 === "charge" || st.ogre3 === "rest")
        ? pass("외눈 거인은 0.65초 동안 제자리에서 빨갛게 깜빡인 뒤 돌진 (공격 예고)")
        : fail(`거인 예고 이상: ${st.ogre1} → ${st.ogre2} → ${st.ogre3}, 제자리 ${st.ogreStill}`);
      st.mage1 === "cast" && st.mageWait && st.mageFire ? pass("마법사는 0.8초 동안 손에 불을 모은 뒤 불덩이를 쏨 (공격 예고)")
        : fail(`마법사 예고 이상: ${st.mage1}, 기다림 ${st.mageWait}, 쏨 ${st.mageFire}`);
      st.garg1 === "warn" && st.gargWait && st.gargFire ? pass("가고일은 0.6초 동안 눈이 빨개진 뒤 화살을 쏨 (함정 예고)")
        : fail(`가고일 예고 이상: ${st.garg1}, 기다림 ${st.gargWait}, 쏨 ${st.gargFire}`);
      st.pops.includes("down>warn>up") ? pass("솟는 가시는 덜컹거린 뒤에 솟음 (함정 예고)") : fail("솟는 가시 순서 이상: " + st.pops);
      console.log("[보스]");
      st.bossHas && st.locked && st.lockedPhase === "play" ? pass("마지막 스테이지에 문지기가 있고, 쓰러뜨리기 전에는 보물상자가 잠겨 있음")
        : fail(`보스·잠금 이상: 보스 ${st.bossHas}, 잠김 ${st.locked}, 상자에 닿았을 때 ${st.lockedPhase}`);
      const bs = st.bossSeq.split(">");
      const okOrder = bs.every((s, i) => (s !== "charge" || bs[i - 1] === "windup") && (s !== "leap" || bs[i - 1] === "crouch"));
      const all3 = ["windup", "crouch", "roar"].every((s) => bs.includes(s));
      okOrder && all3 ? pass("문지기는 돌진·내려찍기·바위 세 가지를 쓰고, 공격마다 먼저 예고함")
        : fail("문지기 공격 순서 이상: " + st.bossSeq);
      console.log("     (문지기 상태 순서: " + st.bossSeq + ")");
      st.bossGone && st.unlocked ? pass(`문지기를 할퀴어서 쓰러뜨리면(${st.bossSwings}번) 보물상자가 열림`)
        : fail(`문지기를 쓰러뜨려도 이상: 사라짐 ${st.bossGone}, 열림 ${st.unlocked}`);
    }
    // 대시 잔상 사진
    await js(`(() => { __G.setStage(0); __G.setHazards(false); cardTime = 0; player.x = 120; player.y = 15 * TILE - player.h; player.facing = 1; dashPressed = true; })()`);
    await sleep(90);
    await shot("11-대시");
    await js(`__G.setHazards(true)`);

    // 예고 장면 사진
    await js(`(() => { __G.setStage(2); invincible = 99; const d = balls.find((b) => b.type === "drop");
                       player.x = d.x - player.w / 2; player.y = 15 * TILE - player.h; cardTime = 0; update(1 / 60); })()`);
    await sleep(150);
    await shot("11-철퇴예고");

    // 출구 → 클리어 화면 → 키 → 다음 스테이지
    const c1 = await js(`(() => { __G.setStage(0); invincible = 0; player.x = exit.x; player.y = exit.y + 16 - player.h; player.vy = 0;
                                  update(1 / 60); return { phase, text: document.getElementById("msg").innerText }; })()`);
    await sleep(100);
    await shot("12-클리어");
    c1.phase === "clear" ? pass("보물상자에 닿으면 스테이지 클리어") : fail("보물상자에 닿아도 클리어되지 않음: " + c1.phase);
    const wait = await js(`CLEAR_WAIT`);
    await sleep(wait * 1000 + 400);
    await shot("13-스테이지2");
    const s2 = await js(`({ stage, phase })`);
    s2.stage === 1 && s2.phase === "play" ? pass(`키를 안 눌러도 ${wait}초 뒤 스테이지 2 가 바로 시작됨`) : fail(`클리어 뒤 스테이지가 ${s2.stage + 1}, 상태 ${s2.phase}`);
    // 키를 누르면 기다리지 않고 넘어감
    await js(`(() => { invincible = 0; player.x = exit.x; player.y = exit.y + 16 - player.h; player.vy = 0; update(1 / 60); })()`);
    await sleep(300);
    await key("keyDown", "Enter"); await key("keyUp", "Enter");
    await sleep(50);
    const s3 = await js(`({ stage, phase })`);
    s3.stage === 2 && s3.phase === "play" ? pass("클리어 글자가 떠 있을 때 키를 누르면 기다리지 않고 바로 다음 스테이지") : fail(`키로 넘기기 이상: 스테이지 ${s3.stage + 1}, ${s3.phase}`);

    // 마지막 스테이지 → 모두 클리어 → 키 → 처음부터
    const c3 = await js(`(() => { __G.setStage(${"__G.stages - 1"}); if (__G.unlockExit) __G.unlockExit(); invincible = 0; player.x = exit.x; player.y = exit.y + 16 - player.h; player.vy = 0;
                                  update(1 / 60); return { phase, text: document.getElementById("msg").innerText }; })()`);
    await sleep(100);
    await shot("14-모두클리어");
    c3.phase === "allclear" ? pass("마지막 보물상자에 닿으면 모두 클리어 화면이 나옴") : fail("마지막 스테이지 클리어 이상: " + c3.phase);
    console.log("     (모두 클리어 글자: " + c3.text.replace(/\n+/g, " / ") + ")");
    await sleep(800);
    await key("keyDown", "Enter"); await key("keyUp", "Enter");
    await sleep(200);
    const s0 = await js(`({ stage, phase, lives, score })`);
    s0.stage === 0 && s0.phase === "play" && s0.lives === 3 && s0.score === 0
      ? pass("모두 클리어 뒤 키를 누르면 스테이지 1 부터 새로 시작") : fail(`모두 클리어 뒤: 스테이지 ${s0.stage + 1}, ${s0.phase}, 목숨 ${s0.lives}, 금화 ${s0.score}`);

    // 스테이지마다 가운데쯤 사진 (맵 모양 눈으로 보기)
    for (let s = 0; s < (await js(`__G.stages`)); s++) {
      await js(`(() => { __G.setStage(${s}); __G.setHazards(false); cardTime = 0; player.x = WORLD_W / 2; player.y = 3 * TILE; player.vy = 0; })()`);
      await sleep(700);
      await shot(`15-스테이지${s + 1}가운데`);
    }
    await js(`(() => { __G.setHazards(true); newGame(); })()`);
  }

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
