// 맛집 평점판 확인 도구
// 쓰는 법 (QUEST-TRACK-2 폴더에서):
//   node week-07/check/check.mjs            ← 내 작품 (week-07/index.html)
// Edge(없으면 Chrome)를 화면 없이 띄워서 작품을 열고, 사람이 하듯 눌러 보고 글을 써 보고, 사진을 찍는다.
// 사진은 check/shots/, 브라우저 임시 폴더는 check/.browser-tmp/ 에 생긴다. (둘 다 커밋 안 함)
//
// 확인하는 것
//  1. 처음 열면 빈 안내가 나오고, 위쪽에 "로그인 자리"만 있는지 (눌러지는 로그인 기능은 없음)
//  2. 프로필 없이는 리뷰를 못 쓰고, 프로필(이름 · 그림 · 색)을 만들면 저장되는지
//  3. 리뷰 쓰기: 빈칸 안내, 별점, 저장, 평균 계산
//  4. 사진: 크게 찍은 사진이 800px 이하로 줄어서 저장되고 보이는지
//  5. 댓글: 달기, 저장, 작성자 이름
//  6. 목록: 평균 · 리뷰 개수, 검색(가게 · 메뉴), 별점 거르기, 순서 3가지
//  7. 가게 자세히: 별점 분포, 많이 시킨 메뉴
//  8. 내 프로필: 어떤 가게에 어떤 리뷰를 남겼는지, 이름을 고치면 옛 리뷰 이름도 바뀌는지
//  8-1. 로그인한 상태면 "로그인 자리"가 [로그아웃] 단추로 바뀌고, 누르면 원래 자리로 돌아오는지 (로그인 자체는 아직 없음)
//  8-2. 가게 주인: 내 가게 등록(리뷰가 없는 가게도), 한 가게에 주인 한 명, 사장님 답글 표시,
//       댓글 좋아요/싫어요(한 사람 한 번, 내 댓글에는 못 누름), 사장님 매너온도 계산
//  9. 저장: 다시 열어도 남는지, 저장 공간이 가득 차면 까닭을 알려 주고 되돌리는지, 저장 코드가 store.js 한곳에만 있는지
// 10. 이상한 글(HTML 태그)이 그대로 글자로 보이는지
// 11. 폰 · 태블릿 · 컴퓨터 화면 폭(320~1920)에서 잘리거나 옆으로 밀리지 않는지
// 12. 브라우저 오류 메시지가 없는지

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEEK = resolve(HERE, "..");
const APP = resolve(WEEK, "index.html");
const SHOTS = join(HERE, "shots");
const TMP = join(HERE, ".browser-tmp");
const PORT = 9337;
const KEY = "pt-matjip-v1";

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];

const ok = [], bad = [];
const pass = (text) => { ok.push(text); console.log("  ✅ " + text); };
const fail = (text) => { bad.push(text); console.log("  ❌ " + text); };
const check = (cond, good, badText) => (cond ? pass(good) : fail(badText));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(APP)) { console.log("작품 파일이 없어요: " + APP); process.exit(1); }
const browserPath = BROWSERS.find(existsSync);
if (!browserPath) { console.log("Edge 나 Chrome 을 찾지 못했어요."); process.exit(1); }

rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
rmSync(TMP, { recursive: true, force: true });

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
async function js(expr) { // 작품 안에서 코드를 돌리고 결과를 받아 옴
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.data, "base64"));
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

// ── 도우미 ──
const Q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const text = (sel) => js(`${Q(sel)}?.innerText.trim() ?? null`);
const count = (sel) => js(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const click = (sel) => js(`${Q(sel)}.click()`);
const setVal = (sel, v) => js(`(() => { const e = ${Q(sel)}; e.value = ${JSON.stringify(v)};
  e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); })()`);
const submit = (sel) => js(`${Q(sel)}.requestSubmit()`);
const stored = () => js(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) || "null")`);
async function until(expr, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await js(expr)) return true; } catch {} await sleep(60); }
  return false;
}
async function go(hash) {
  await js(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(150);
}
let openCount = 0;
// seed: 미리 넣어 둘 저장 내용(없으면 처음 연 것처럼 비움). keep: 저장된 것을 그대로 두고 다시 열기
async function openApp({ seed = null, keep = false, hash = "#/" } = {}) {
  let id = null;
  if (!keep) {
    const code = seed
      ? `try { localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(seed))}) } catch (e) {}`
      : `try { localStorage.removeItem(${JSON.stringify(KEY)}) } catch (e) {}`;
    id = (await send("Page.addScriptToEvaluateOnNewDocument", { source: code })).identifier;
  }
  await send("Page.navigate", { url: pathToFileURL(APP).href + "?n=" + ++openCount + hash });
  await sleep(300);
  await until(`document.readyState === "complete" && document.getElementById("view").children.length > 0`);
  if (id) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: id });
}

// 가짜 저장 내용 만들기
const me = { id: "me-1", name: "맛객", emoji: "🐻", color: "#ffd6a5" };
const other = (n, emoji = "🦊") => ({ id: "o-" + n, name: n, emoji, color: "#a0c4ff" });
const DAY = 86400000, T0 = Date.UTC(2026, 10, 1, 3, 0, 0);
let rid = 0;
const rev = (shop, menu, stars, textBody, author, day, extra = {}) => ({
  id: "r" + ++rid, shop, menu, stars, text: textBody, photo: null, createdAt: T0 + day * DAY, author, comments: [], ...extra,
});
function seedData(photo) {
  const reviews = [
    rev("골목 치킨", "양념 반반", 3, "양념은 좋은데 기다림이 길어요", other("지민"), 9),
    rev("골목 치킨", "후라이드", 2, "조금 짰어요", me, 8),
    rev("할매 국밥", "순대국밥", 5, "국물이 진하고 든든해요", other("서준", "🐼"), 7, { photo }),
    rev("초밥집", "모둠초밥", 4, "신선해요", other("하늘", "🐧"), 6),
    rev("초밥집", "연어초밥", 4, "연어가 두툼해요", me, 5),
    rev("초밥집", "모둠초밥", 4, "가성비 좋아요", other("지민"), 4),
    rev("초밥집", "우동", 4, "국물이 시원해요", other("서준", "🐼"), 3),
    rev("행복 분식", "떡볶이", 5, "매콤달콤 최고", other("하늘", "🐧"), 2),
    rev("행복 분식", "떡볶이", 4, "떡이 쫄깃해요", me, 1, { comments: [
      { id: "c1", text: "저도 가 봤어요!", createdAt: T0 + 1.5 * DAY, author: other("지민") }] }),
    rev("행복 분식", "김밥", 3, "그냥 평범해요", other("서준", "🐼"), 0),
  ];
  return { profile: me, reviews };
}
// 시험용 사진 만들기 (2000×1500 큰 사진을 고른 것처럼)
const MAKE_FILE = `(() => {
  const c = document.createElement("canvas"); c.width = 2000; c.height = 1500;
  const g = c.getContext("2d"); const gr = g.createLinearGradient(0, 0, 2000, 1500);
  gr.addColorStop(0, "#e76f51"); gr.addColorStop(1, "#f4a261"); g.fillStyle = gr; g.fillRect(0, 0, 2000, 1500);
  g.fillStyle = "#fff"; g.font = "bold 200px sans-serif"; g.fillText("PHOTO", 500, 800);
  return new Promise((res) => c.toBlob((b) => {
    const dt = new DataTransfer(); dt.items.add(new File([b], "food.png", { type: "image/png" }));
    const input = document.getElementById("photo"); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); res(b.size);
  }, "image/png"));
})()`;
const SMALL_PHOTO = `(() => { const c = document.createElement("canvas"); c.width = 320; c.height = 180;
  const g = c.getContext("2d"); g.fillStyle = "#e76f51"; g.fillRect(0, 0, 320, 180); return c.toDataURL("image/jpeg", 0.7); })()`;

const names = () => js(`[...document.querySelectorAll(".shop-card .shop-name")].map((e) => e.innerText.trim())`);

// ── 확인 순서 ──
try {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  console.log("\n작품: " + APP + "\n");

  // 1. 처음 열기
  console.log("[처음 열었을 때]");
  await openApp();
  await shot("1-처음");
  check(await js(`!!${Q("#empty-all")}`), "리뷰가 없으면 \"아직 리뷰가 없어요\" 안내와 [리뷰 쓰기] 단추가 보임", "빈 안내가 안 보임");
  const slot = await js(`(() => { const s = document.getElementById("login-slot"); const r = s.getBoundingClientRect();
    return { text: s.innerText.trim(), tag: s.tagName, inner: s.querySelectorAll("a, button, input, form").length, top: r.top, visible: r.height > 0 }; })()`);
  check(slot.text === "로그인 자리" && slot.visible && slot.top < 120, `화면 위쪽에 "${slot.text}" 가 보임`, "로그인 자리가 위쪽에 안 보임: " + JSON.stringify(slot));
  check(slot.tag === "DIV" && slot.inner === 0, "로그인 자리는 글자만 있는 빈 자리 (누르는 단추 · 입력칸 없음)", "로그인 자리에 기능이 들어 있음: " + JSON.stringify(slot));

  // 2. 프로필 없이 리뷰 쓰기 → 프로필 만들기
  console.log("[프로필]");
  await go("#/write");
  check(await js(`!!${Q("#need-profile")} && !${Q("#write-form")}`), "프로필이 없으면 리뷰 쓰는 칸 대신 \"먼저 프로필을 만들어 주세요\"가 보임", "프로필 없이 리뷰 칸이 열림");
  await go("#/me");
  await submit("#profile-form");
  check((await text("#form-msg")).includes("이름"), "이름 없이 저장하면 안내가 나옴: " + (await text("#form-msg")), "이름 없이 저장됨");
  await setVal("#profile-form [name=name]", "맛객");
  await click('.emoji-btn[data-emoji="🐻"]');
  await click('.color-btn[data-color="#caffbf"]');
  const prev = await js(`(() => { const a = document.querySelector("#p-preview .av"); return { t: a.innerText.trim(), bg: a.style.backgroundColor, n: document.querySelector("#p-preview b").innerText }; })()`);
  check(prev.t === "🐻" && prev.n === "맛객", `고른 그림과 이름이 바로 미리 보임 (${prev.t} ${prev.n})`, "미리 보기: " + JSON.stringify(prev));
  await shot("2-프로필");
  await submit("#profile-form");
  let st = await stored();
  check(st?.profile?.name === "맛객" && st.profile.emoji === "🐻" && st.profile.color === "#caffbf" && st.profile.id,
    "프로필(이름 · 그림 · 색)이 이 기기에 저장됨", "저장된 프로필: " + JSON.stringify(st?.profile));
  check(await js(`!!${Q("#no-mine")}`), "남긴 리뷰가 없으면 \"아직 남긴 리뷰가 없어요\"가 보임", "내 리뷰 빈 안내가 없음");
  const profileId = st.profile.id;

  // 3. 리뷰 쓰기
  console.log("[리뷰 쓰기]");
  await go("#/write");
  check(await js(`!!${Q("#write-form")} && document.querySelector("#write-form .av").innerText.trim() === "🐻"`), "프로필이 있으면 리뷰 칸이 열리고 작성자 그림이 보임", "리뷰 칸이 안 열림");
  await shot("3-리뷰쓰기-빈칸");
  const tries = [
    [[], "가게"], [["shop", "행복 분식"], "메뉴"], [["menu", "떡볶이"], "별점"], [["#star", 4], "리뷰"],
  ];
  for (const [[a, b], word] of tries) {
    if (a === "#star") await click('.star-btn[data-v="4"]'); else if (a) await setVal(`[name=${a}]`, b);
    await submit("#write-form");
    const m = await text("#form-msg");
    check(m.includes(word), `빈칸이 남으면 안내가 나옴 — "${m}"`, `빈칸 안내가 이상함 (기대: ${word}): "${m}"`);
  }
  check((await stored())?.reviews?.length === 0, "빈칸이 있을 때는 아무것도 저장되지 않음", "빈칸인데 저장됨");
  const starState = await js(`[...document.querySelectorAll(".star-btn")].map((b) => b.classList.contains("on")).join()`);
  check(starState === "true,true,true,true,false" && (await text("#star-word")).startsWith("4점"), "별 4번째를 누르면 별 4개가 켜지고 \"4점\"이 보임", "별 상태: " + starState);
  await shot("3-리뷰쓰기-별점");
  await setVal("[name=text]", "매콤달콤 맛있어요\n또 올게요");
  await submit("#write-form");
  await until(`location.hash.startsWith("#/shop/")`);
  check(await js(`location.hash.startsWith("#/shop/") && !!${Q("#shop-detail")}`), "남기면 그 가게 화면으로 넘어감", "남긴 뒤 화면: " + (await js("location.hash")));
  let d = await js(`({ name: ${Q(".shop-name")}.innerText, avg: ${Q(".avg-num")}.innerText, cnt: ${Q(".shop-head .count")}.innerText, text: ${Q(".r-text")}.innerText, menu: ${Q(".r-menu")}.innerText, who: ${Q(".r-name")}.innerText })`);
  check(d.name === "행복 분식" && d.avg === "4.0" && d.cnt === "리뷰 1개" && d.menu.includes("떡볶이") && d.who === "맛객" && d.text.includes("또 올게요"),
    `리뷰가 저장되어 보임: ${d.name} 평균 ${d.avg}, ${d.cnt}, 메뉴 ${d.menu.replace("🍴 ", "")}, 작성자 ${d.who}`, "남긴 리뷰: " + JSON.stringify(d));
  st = await stored();
  check(st.reviews.length === 1 && st.reviews[0].author.id === profileId && st.reviews[0].stars === 4, "저장된 리뷰에 작성자 · 별점이 들어 있음", "저장 내용: " + JSON.stringify(st.reviews));
  await shot("3-리뷰남김");

  // 4. 사진
  console.log("[사진]");
  await go("#/write?shop=" + encodeURIComponent("행복 분식"));
  check((await js(`${Q("[name=shop]")}.value`)) === "행복 분식", "[이 가게에 리뷰 쓰기]로 열면 가게 이름이 미리 적혀 있음", "가게 이름이 안 채워짐");
  await setVal("[name=menu]", "순대");
  await click('.star-btn[data-v="5"]');
  await setVal("[name=text]", "사진도 올려 봐요");
  const pngSize = await js(MAKE_FILE);
  const gotPhoto = await until(`!!document.getElementById("photo-preview") && document.getElementById("photo-preview").naturalWidth > 0`);
  check(gotPhoto, `사진을 고르면 미리 보임 (원래 ${(pngSize / 1024).toFixed(0)}KB)`, "사진 미리 보기가 안 보임");
  await shot("4-사진고름");
  await submit("#write-form");
  await until(`location.hash.startsWith("#/shop/")`);
  st = await stored();
  const photo = st.reviews[0].photo;
  const dim = await js(`new Promise((res) => { const i = new Image(); i.onload = () => res(i.width + "x" + i.height); i.onerror = () => res("열리지 않음"); i.src = ${JSON.stringify(photo)}; })`);
  const [pw, ph] = dim.split("x").map(Number);
  check(photo?.startsWith("data:image/jpeg") && Math.max(pw, ph) === 800 && pw / ph > 1.3 && pw / ph < 1.37,
    `2000×1500 사진이 ${dim} 으로 줄어 JPEG(${(photo.length / 1024).toFixed(0)}KB)로 저장됨`, "저장된 사진: " + dim);
  check(await js(`(() => { const i = document.querySelector(".review .r-photo"); return !!i && i.naturalWidth > 0; })()`), "리뷰에 사진이 보임", "리뷰에 사진이 안 보임");
  d = await js(`({ avg: ${Q(".avg-num")}.innerText, cnt: ${Q(".shop-head .count")}.innerText })`);
  check(d.avg === "4.5" && d.cnt === "리뷰 2개", `같은 가게에 한 번 더 남기면 하나로 묶임: 평균 ${d.avg}, ${d.cnt} ((4+5)÷2)`, "평균: " + JSON.stringify(d));
  await shot("4-사진리뷰");
  await go("#/write");
  await setVal("#photo", "");           // 파일 칸 비우기 시도는 무시되지만 사진 빼기 단추는 아래에서 확인
  await js(MAKE_FILE);
  await until(`!!document.getElementById("photo-preview")`);
  await click(".photo-clear");
  check(await js(`!document.getElementById("photo-preview")`), "[사진 빼기]를 누르면 사진이 빠짐", "사진이 안 빠짐");

  // 5. 댓글
  console.log("[댓글]");
  await go("#/shop/" + encodeURIComponent("행복 분식"));
  const firstId = await js(`${Q(".review")}.dataset.id`);
  await setVal(`.review[data-id="${firstId}"] .c-form input`, "저도 가 봤어요, 맛있죠!");
  await submit(`.review[data-id="${firstId}"] .c-form`);
  const cm = await js(`(() => { const r = document.querySelector('.review[data-id="${firstId}"]'); return { n: r.querySelector(".c-count").innerText, t: r.querySelector(".c-text").innerText, who: r.querySelector(".c-head b").innerText }; })()`);
  check(cm.n === "댓글 1개" && cm.t.includes("맛있죠") && cm.who === "맛객", `댓글이 달림: "${cm.t}" — ${cm.who} (${cm.n})`, "댓글: " + JSON.stringify(cm));
  await submit(`.review[data-id="${firstId}"] .c-form`);
  check((await text(`.review[data-id="${firstId}"] .c-count`)) === "댓글 1개", "빈 댓글은 달리지 않음", "빈 댓글이 달림");
  st = await stored();
  check(st.reviews.find((r) => r.id === firstId).comments.length === 1, "댓글이 그 리뷰 안에 저장됨", "저장된 댓글: " + JSON.stringify(st.reviews.find((r) => r.id === firstId).comments));
  await shot("5-댓글");

  // 9-1. 다시 열어도 남아 있는지
  console.log("[저장]");
  await openApp({ keep: true, hash: "#/shop/" + encodeURIComponent("행복 분식") });
  d = await js(`({ avg: ${Q(".avg-num")}.innerText, n: document.querySelectorAll(".review").length, c: document.querySelectorAll(".comment").length, p: document.querySelectorAll(".r-photo").length })`);
  check(d.avg === "4.5" && d.n === 2 && d.c === 1 && d.p === 1, "창을 닫았다 다시 열어도 리뷰 2개 · 사진 · 댓글이 그대로 있음", "다시 연 뒤: " + JSON.stringify(d));

  // 저장 공간이 가득 찼을 때
  await go("#/write");
  await setVal("[name=shop]", "가득 찬 집"); await setVal("[name=menu]", "국수"); await click('.star-btn[data-v="3"]'); await setVal("[name=text]", "저장이 안 되는 척");
  await js(`window.__orig = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException("full", "QuotaExceededError"); }`);
  await submit("#write-form");
  const full = await text("#form-msg");
  await js(`Storage.prototype.setItem = window.__orig`);
  check(full.includes("가득") && (await stored()).reviews.length === 2,
    `저장 공간이 가득 차면 까닭을 알려 주고 아무것도 바뀌지 않음 — "${full}"`, `가득 찬 때: "${full}", 저장된 리뷰 ${(await stored()).reviews.length}개`);
  check(await js(`!!${Q("#write-form")}`), "그때 쓰던 글은 화면에 그대로 남아 있음", "쓰던 글이 사라짐");
  const only = readFileSync(join(WEEK, "index.html"), "utf8");
  check(!/localStorage|sessionStorage|indexedDB/.test(only) && /localStorage/.test(readFileSync(join(WEEK, "store.js"), "utf8")),
    "저장하는 코드는 store.js 한곳에만 있음 (index.html 에는 localStorage 가 없음)", "index.html 이 저장소를 직접 씀");

  // 6. 목록
  console.log("[목록 · 평균 · 검색 · 거르기 · 순서]");
  const photoUrl = await js(SMALL_PHOTO);
  await openApp({ seed: seedData(photoUrl) });
  await shot("6-목록");
  const cards = await js(`[...document.querySelectorAll(".shop-card")].map((c) => ({ n: c.querySelector(".shop-name").innerText, a: c.querySelector(".avg-num").innerText, c: c.querySelector(".count").innerText }))`);
  const byName = Object.fromEntries(cards.map((c) => [c.n, c]));
  check(cards.length === 4, "가게 4곳이 카드로 보임", "카드 수: " + cards.length);
  check(byName["행복 분식"]?.a === "4.0" && byName["행복 분식"].c === "리뷰 3개" && byName["골목 치킨"]?.a === "2.5" && byName["골목 치킨"].c === "리뷰 2개" && byName["할매 국밥"]?.a === "5.0",
    "평균과 리뷰 개수가 맞음: 행복 분식 4.0 (5·4·3), 골목 치킨 2.5 (3·2), 할매 국밥 5.0", "카드: " + JSON.stringify(cards));
  check(await js(`document.querySelector(".sub").innerText.includes("가게 4곳 · 리뷰 10개")`), "위쪽에 \"가게 4곳 · 리뷰 10개\"", "개수 글: " + (await text(".sub")));
  check(await js(`document.querySelectorAll(".shop-card .thumb img").length === 1`), "사진이 있는 가게(할매 국밥)만 카드에 사진이 보임", "카드 사진 수가 이상함");
  check((await names()).join() === "할매 국밥,초밥집,행복 분식,골목 치킨", "처음 순서는 평균 높은 순 (같은 4.0 이면 리뷰 많은 초밥집이 먼저): " + (await names()).join(" > "), "처음 순서: " + (await names()).join());
  await setVal("#sort", "count");
  check((await names()).join() === "초밥집,행복 분식,골목 치킨,할매 국밥", "[리뷰 많은 순]: " + (await names()).join(" > "), "리뷰 많은 순: " + (await names()).join());
  await setVal("#sort", "new");
  check((await names()).join() === "골목 치킨,할매 국밥,초밥집,행복 분식", "[최신순] (가장 나중에 리뷰 받은 가게부터): " + (await names()).join(" > "), "최신순: " + (await names()).join());
  await setVal("#sort", "avg");
  await setVal("#min", "4");
  check((await names()).join() === "할매 국밥,초밥집,행복 분식", "[4점 이상]만 거르면 골목 치킨이 빠짐", "4점 이상: " + (await names()).join());
  await setVal("#min", "0");
  await setVal("#q", "치킨");
  check((await names()).join() === "골목 치킨", "가게 이름으로 찾기: \"치킨\" → 골목 치킨", "치킨 검색: " + (await names()).join());
  await setVal("#q", "김밥");
  check((await names()).join() === "행복 분식", "메뉴로도 찾기: \"김밥\" → 행복 분식", "김밥 검색: " + (await names()).join());
  await setVal("#q", "없는집");
  check(await js(`!!${Q("#no-match")}`), "찾는 가게가 없으면 \"맞는 가게가 없어요\"가 보임", "없는 가게 안내가 없음");
  await shot("6-검색결과없음");
  await setVal("#q", "");
  await click(".shop-card");
  await until(`location.hash.startsWith("#/shop/")`);
  check(await js(`!!${Q("#shop-detail")}`), "카드를 누르면 가게 자세히 화면으로 감", "카드를 눌러도 안 넘어감");
  await js(`history.back()`); await sleep(300);
  const keep = await js(`({ sort: ${Q("#sort")}.value, n: document.querySelectorAll(".shop-card").length })`);
  check(keep.n === 4, "뒤로 가면 목록으로 돌아옴", "뒤로 간 뒤: " + JSON.stringify(keep));

  // 7. 가게 자세히
  console.log("[가게 자세히]");
  await go("#/shop/" + encodeURIComponent("행복 분식"));
  d = await js(`({
    avg: ${Q(".avg-num")}.innerText,
    dist: [5,4,3,2,1].map((n) => document.querySelector('.dist-row[data-star="' + n + '"] .num').innerText).join(),
    w5: document.querySelector('.dist-row[data-star="5"] .bar span').style.width,
    w2: document.querySelector('.dist-row[data-star="2"] .bar span').style.width,
    pop: [...document.querySelectorAll(".pop li")].map((li) => li.innerText.replace(/\\s+/g, " ")),
    n: document.querySelectorAll(".review").length, c: document.querySelectorAll(".comment").length })`);
  check(d.avg === "4.0" && d.dist === "1,1,1,0,0" && d.w5 === "100%" && d.w2 === "0%", "별점 분포: 5점 1 · 4점 1 · 3점 1 · 2점 0 · 1점 0, 막대 길이도 맞음", "분포: " + JSON.stringify(d));
  check(d.pop[0].startsWith("떡볶이 2번 · 평균 4.5점") && d.pop[1].startsWith("김밥 1번"), `많이 시킨 메뉴: ${d.pop.join(" / ")}`, "인기 메뉴: " + JSON.stringify(d.pop));
  check(d.n === 3 && d.c === 1, "리뷰 3개 · 댓글 1개가 보임 (미리 넣어 둔 다른 사람 댓글 포함)", "리뷰 · 댓글 수: " + JSON.stringify(d));
  await shot("7-가게자세히");
  await go("#/shop/" + encodeURIComponent("없는 가게"));
  check(await js(`document.getElementById("view").innerText.includes("찾지 못했어요")`), "없는 가게 주소는 \"찾지 못했어요\" 안내", "없는 가게 주소 화면이 이상함");

  // 8. 내 프로필에서 내 리뷰 모아 보기
  console.log("[내 프로필: 어떤 가게에 어떤 리뷰를 남겼는지]");
  await go("#/me");
  const mine = await js(`({
    sum: document.getElementById("my-summary").innerText,
    shops: [...document.querySelectorAll(".my-shop")].map((s) => s.querySelector(".my-shop-name").innerText + ":" + [...s.querySelectorAll(".my-review")].map((r) => r.querySelector(".chip").innerText.replace("🍴 ", "") + "/" + r.querySelector(".r-text").innerText).join("|")),
    others: [...document.querySelectorAll(".my-review .r-text")].some((e) => e.innerText.includes("신선해요")) })`);
  check(mine.sum === "가게 3곳 · 리뷰 3개 · 댓글 0개", `요약: ${mine.sum}`, "요약: " + mine.sum);
  check(mine.shops.length === 3 && mine.shops.some((s) => s === "행복 분식:떡볶이/떡이 쫄깃해요") && mine.shops.some((s) => s === "골목 치킨:후라이드/조금 짰어요") && mine.shops.some((s) => s === "초밥집:연어초밥/연어가 두툼해요") && !mine.others,
    "내가 남긴 리뷰만 가게별로 모여 보임: " + mine.shops.join("  ·  "), "내 리뷰: " + JSON.stringify(mine));
  await shot("8-내프로필");
  await setVal("#profile-form [name=name]", "새이름");
  await click('.emoji-btn[data-emoji="🐼"]');
  await submit("#profile-form");
  st = await stored();
  const mineAfter = st.reviews.filter((r) => r.author.id === "me-1");
  const cmtAfter = st.reviews.flatMap((r) => r.comments).filter((c) => c.author.id === "me-1");
  const notMine = st.reviews.filter((r) => r.author.id !== "me-1").every((r) => r.author.name !== "새이름");
  check(mineAfter.length === 3 && mineAfter.every((r) => r.author.name === "새이름" && r.author.emoji === "🐼") && notMine,
    "프로필 이름 · 그림을 고치면 내가 쓴 리뷰 3개의 이름 · 그림도 같이 바뀌고 남의 리뷰는 그대로", "고친 뒤: " + JSON.stringify(mineAfter.map((r) => r.author)));
  await go("#/shop/" + encodeURIComponent("행복 분식"));
  check((await js(`[...document.querySelectorAll(".r-name")].map((e) => e.innerText).includes("새이름")`)), "가게 화면에서도 새 이름으로 보임", "가게 화면에 새 이름이 안 보임");
  // 내 댓글 수
  await setVal(`.review .c-form input`, "내 새 댓글");
  await submit(`.review .c-form`);
  await go("#/me");
  check((await text("#my-summary")).includes("댓글 1개"), "내가 단 댓글 수도 요약에 보임: " + (await text("#my-summary")), "댓글 요약: " + (await text("#my-summary")));

  // 8-1. 로그아웃 단추
  console.log("[로그아웃 단추 (로그인한 상태일 때)]");
  const SESSION = "pt-matjip-session";
  await openApp({ seed: seedData(photoUrl) });
  check(await js(`document.getElementById("login-slot").innerText.trim() === "로그인 자리" && !document.getElementById("logout-btn")`),
    "로그인한 상태가 아니면 \"로그인 자리\" 글자만 보이고 로그아웃 단추는 없음", "로그인 안 했는데 로그아웃 단추가 보임");
  await js(`localStorage.setItem(${JSON.stringify(SESSION)}, JSON.stringify({ at: 1 }))`);
  await openApp({ keep: true });
  const lo = await js(`(() => { const s = document.getElementById("login-slot"), b = document.getElementById("logout-btn"); const r = b?.getBoundingClientRect();
    return { btn: b?.innerText.trim(), tag: b?.tagName, text: s.innerText.trim(), top: r?.top, h: r?.height, slotTop: s.getBoundingClientRect().top }; })()`);
  check(lo.btn === "로그아웃" && lo.tag === "BUTTON" && lo.text === "로그아웃" && lo.h >= 40 && lo.top < 120,
    "로그인한 상태면 \"로그인 자리\" 대신 위쪽에 [로그아웃] 단추가 보임", "로그인한 상태의 위쪽: " + JSON.stringify(lo));
  await shot("8-로그아웃단추");
  await go("#/me");
  check(await js(`!!document.getElementById("logout-btn")`), "다른 화면(내 프로필)에서도 [로그아웃] 단추가 그대로 보임", "다른 화면에서 단추가 사라짐");
  await click("#logout-btn");
  const after = await js(`({ text: document.getElementById("login-slot").innerText.trim(), btn: !!document.getElementById("logout-btn"),
    session: localStorage.getItem(${JSON.stringify(SESSION)}), toast: document.getElementById("toast").innerText })`);
  check(after.text === "로그인 자리" && !after.btn && after.session === null && after.toast.includes("로그아웃했어요"),
    "[로그아웃]을 누르면 로그인한 상태가 지워지고 \"로그인 자리\"로 돌아옴", "로그아웃 뒤: " + JSON.stringify(after));
  st = await stored();
  check(st.profile?.name === "새이름" || st.profile?.name === "맛객", "로그아웃해도 프로필과 남긴 리뷰는 그대로 남음 (리뷰 " + st.reviews.length + "개)", "로그아웃하니 저장 내용이 바뀜");
  await openApp({ keep: true });
  check(await js(`!document.getElementById("logout-btn")`), "다시 열어도 로그아웃한 상태가 유지됨", "다시 열면 로그아웃 단추가 또 나옴");

  // 8-2. 가게 주인 · 매너온도
  console.log("[가게 주인 · 사장님 답글 · 좋아요/싫어요 · 매너온도]");
  const K = (n) => "#/shop/" + encodeURIComponent(n);
  const ownerOf = (who) => ({ name: "골목 치킨", registeredAt: T0, owner: who });
  // (a) 프로필이 없을 때
  await openApp({ seed: { ...seedData(photoUrl), profile: null }, hash: K("행복 분식") });
  check(await js(`!document.getElementById("claim-btn") && document.getElementById("owner-box").innerText.includes("프로필을 만든 뒤")`),
    "프로필이 없으면 [내 가게로 등록하기] 대신 \"프로필을 만든 뒤 등록할 수 있어요\" 안내가 보임", "프로필 없을 때 주인 칸이 이상함");
  check(await js(`(() => { const b = [...document.querySelectorAll(".react-btn")]; return b.length > 0 && b.every((x) => x.disabled); })()`),
    "프로필이 없으면 좋아요/싫어요 단추가 숫자만 보이고 눌러지지 않음", "프로필 없는데 좋아요 단추가 눌러짐");

  // (b) 내 가게로 등록하기 (리뷰가 이미 있는 가게)
  await openApp({ seed: seedData(photoUrl), hash: K("골목 치킨") });
  check(await js(`!!document.getElementById("claim-btn") && !document.querySelector(".temp-num")`), "주인이 없는 가게에는 [내 가게로 등록하기] 단추가 보임", "등록 단추가 없음");
  await shot("8-2-가게등록전");
  await click("#claim-btn");
  d = await js(`({ name: ${Q(".owner-name")}?.innerText, badge: ${Q("#owner-box .badge")}?.innerText, temp: ${Q(".temp-num")}?.innerText, btn: !!document.getElementById("claim-btn"),
    mine: document.getElementById("owner-box").innerText.includes("내 가게예요"), form: ${Q(".c-form input")}.placeholder, send: ${Q(".c-form button")}.innerText })`);
  check(d.name === "맛객" && d.badge === "사장님" && d.temp === "36.5°C" && !d.btn && d.mine,
    `등록하면 사장님 ${d.name} · ${d.badge} · 매너온도 ${d.temp} 로 바뀌고 단추는 사라짐`, "등록한 뒤: " + JSON.stringify(d));
  check(d.form.includes("사장님 답글") && d.send === "답글 달기", "내 가게 리뷰에는 댓글 칸이 \"사장님 답글\" / [답글 달기] 로 바뀜", "사장님 댓글 칸: " + JSON.stringify(d));
  await shot("8-2-가게등록후");
  st = await stored();
  check(st.owners?.["골목 치킨"]?.owner.id === "me-1", "주인 등록이 이 기기에 저장됨", "저장된 주인: " + JSON.stringify(st.owners));
  const again = await js(`[Store.registerShop("골목  치킨").message, Store.registerShop("  골목 치킨 ").ok]`);
  check(again[0].includes("이미 내 가게") && again[1] === false, "같은 가게를 또 등록하려 하면 막힘 (띄어쓰기가 달라도 같은 가게): \"" + again[0] + "\"", "다시 등록: " + JSON.stringify(again));
  await openApp({ keep: true, hash: K("골목 치킨") });
  check((await text(".owner-name")) === "맛객", "다시 열어도 내 가게로 남아 있음", "다시 연 뒤 주인: " + (await text(".owner-name")));

  // (c) 남의 가게
  const sdC = seedData(photoUrl);
  sdC.owners = { "행복 분식": { name: "행복 분식", registeredAt: T0, owner: other("사장님A", "🧑") } };
  await openApp({ seed: sdC, hash: K("행복 분식") });
  d = await js(`({ claim: !!document.getElementById("claim-btn"), name: ${Q(".owner-name")}.innerText, ph: ${Q(".c-form input")}.placeholder, send: ${Q(".c-form button")}.innerText })`);
  check(!d.claim && d.name === "사장님A" && d.ph === "댓글을 남겨 보세요" && d.send === "달기", "남의 가게에는 등록 단추가 없고, 나는 그대로 일반 댓글을 달 수 있음", "남의 가게: " + JSON.stringify(d));
  const steal = await js(`Store.registerShop("행복 분식")`);
  check(steal.ok === false && steal.message.includes("이미 주인이 등록된"), "이미 주인이 있는 가게는 다른 사람이 등록할 수 없음: \"" + steal.message + "\"", "남의 가게 등록: " + JSON.stringify(steal));
  await setVal(".review .c-form input", "저도 손님이에요");
  await submit(".review .c-form");
  st = await stored();
  const plain = st.reviews.flatMap((r) => r.comments).find((c) => c.text === "저도 손님이에요");
  check(plain && plain.owner === false && !(await js(`[...document.querySelectorAll(".comment")].some((c) => c.innerText.includes("저도 손님이에요") && c.querySelector(".badge"))`)),
    "주인이 아닌 사람의 댓글에는 \"사장님\" 표시가 붙지 않음", "일반 댓글 표시가 이상함");

  // (d) 리뷰가 아직 없는 가게 등록 (내 프로필)
  await openApp({ seed: seedData(photoUrl), hash: "#/me" });
  check(await js(`!!document.getElementById("no-owned")`), "내 프로필에 \"아직 등록한 내 가게가 없어요\"가 보임", "내 가게 빈 안내가 없음");
  await submit("#shop-form");
  check((await text("#shop-msg")).includes("가게 이름"), "이름 없이 등록하면 안내가 나옴: " + (await text("#shop-msg")), "이름 없이 등록됨");
  await setVal("#shop-form [name=shop]", "새 가게");
  await submit("#shop-form");
  await setVal("#shop-form [name=shop]", "행복 분식");
  await submit("#shop-form");
  d = await js(`({ items: [...document.querySelectorAll("#owned-list li")].map((li) => li.innerText.replace(/\\s+/g, " ")), temp: ${Q("#owner-panel .temp-num")}.innerText })`);
  check(d.items.length === 2 && d.items.some((t) => t === "새 가게 아직 리뷰가 없어요") && d.items.some((t) => t === "행복 분식 리뷰 3개 · 평균 4.0점") && d.temp === "36.5°C",
    "리뷰 없는 새 가게도, 리뷰가 이미 있는 가게도 내 가게로 등록됨: " + d.items.join(" / "), "내 가게 목록: " + JSON.stringify(d));
  await shot("8-2-내가게");
  await go("#/");
  const cardsD = await js(`[...document.querySelectorAll(".shop-card")].map((c) => c.innerText.replace(/\\s+/g, " "))`);
  const newCard = cardsD.find((t) => t.includes("새 가게"));
  check(cardsD.length === 5 && newCard?.includes("아직 리뷰가 없어요") && newCard.includes("사장님 등록 · 매너온도 36.5°C") && (await text(".sub")).includes("가게 5곳 · 리뷰 10개"),
    "목록에 리뷰 없는 새 가게도 카드로 나오고(가게 5곳), \"사장님 등록 · 매너온도\"가 보임", "목록: " + JSON.stringify(cardsD) );
  await shot("8-2-목록-새가게");
  await go(K("새 가게"));
  check(await js(`!!document.getElementById("no-review") && document.querySelectorAll(".review").length === 0 && !!document.querySelector(".owner-name")`),
    "리뷰 없는 가게 화면도 깨지지 않고 \"아직 리뷰가 없어요\"와 주인이 보임", "리뷰 없는 가게 화면이 이상함");
  await js(`Store.addReview({ shop: "새 가게", menu: "국수", stars: 5, text: "첫 손님", photo: null }); route();`);
  check(await js(`!document.getElementById("no-review") && ${Q(".avg-num")}.innerText === "5.0" && document.querySelectorAll(".review").length === 1`),
    "새 가게에 첫 리뷰가 달리면 평균 5.0 으로 바뀜", "첫 리뷰 뒤 화면이 이상함");

  // (e) 사장님 답글 + 매너온도 계산
  const sdE = seedData(photoUrl);
  sdE.owners = { "골목 치킨": ownerOf({ ...me }) };
  await openApp({ seed: sdE, hash: K("골목 치킨") });
  const reviewIds = await js(`[...document.querySelectorAll(".review")].map((r) => r.dataset.id)`);
  const t0 = await text(".temp-num");
  await setVal(`.review[data-id="${reviewIds[0]}"] .c-form input`, "방문해 주셔서 감사합니다!");
  await submit(`.review[data-id="${reviewIds[0]}"] .c-form`);
  d = await js(`({ badge: !!document.querySelector('.review[data-id="${reviewIds[0]}"] .comment.by-owner .badge'), temp: ${Q(".temp-num")}.innerText, detail: ${Q(".temp-detail")}.innerText })`);
  check(t0 === "36.5°C" && d.badge && d.temp === "37.0°C" && d.detail.startsWith("답글 단 리뷰 1개"),
    `사장님 답글에 "사장님" 표시가 붙고, 리뷰 1개에 답글을 달면 매너온도 ${t0} → ${d.temp} (+0.5)`, `답글 뒤: ${t0} → ${JSON.stringify(d)}`);
  await setVal(`.review[data-id="${reviewIds[0]}"] .c-form input`, "또 오세요");
  await submit(`.review[data-id="${reviewIds[0]}"] .c-form`);
  check((await text(".temp-num")) === "37.0°C", "같은 리뷰에 답글을 또 달아도 매너온도는 그대로 37.0°C (답글 도배 막기)", "같은 리뷰 두 번째 답글: " + (await text(".temp-num")));
  await setVal(`.review[data-id="${reviewIds[1]}"] .c-form input`, "다음엔 더 빨리 낼게요");
  await submit(`.review[data-id="${reviewIds[1]}"] .c-form`);
  check((await text(".temp-num")) === "37.5°C", "다른 리뷰에 답글을 달면 37.5°C", "다른 리뷰 답글: " + (await text(".temp-num")));
  await shot("8-2-사장님답글");
  st = await stored();
  check(st.reviews.flatMap((r) => r.comments).filter((c) => c.owner).length === 3, "사장님 답글 3개가 \"사장님 답글\"로 저장됨 (owner: true)", "저장된 사장님 답글 수가 이상함");

  // (f) 좋아요 / 싫어요
  const sdF = seedData(photoUrl);
  const rF = sdF.reviews[0];                                    // 골목 치킨, 지민의 리뷰
  rF.comments = [
    { id: "cr", text: "사장님 답글입니다", createdAt: T0 + 10 * DAY, author: { ...me }, owner: true, likes: ["o-a", "o-b"], dislikes: ["o-c"] },
    { id: "cj", text: "지민의 댓글", createdAt: T0 + 10 * DAY, author: other("지민"), owner: false, likes: [], dislikes: [] },
  ];
  sdF.owners = { "골목 치킨": ownerOf({ ...me }) };
  const asJimin = { ...sdF, profile: other("지민") };
  await openApp({ seed: asJimin, hash: K("골목 치킨") });
  const rb = (id, kind) => `.react-btn[data-comment="${id}"][data-kind="${kind}"]`;
  const react = async () => js(`({ like: ${Q(rb("cr", "like"))}.innerText.trim(), dis: ${Q(rb("cr", "dislike"))}.innerText.trim(), temp: ${Q(".temp-num")}.innerText,
    onLike: ${Q(rb("cr", "like"))}.classList.contains("on"), onDis: ${Q(rb("cr", "dislike"))}.classList.contains("on") })`);
  let rx = await react();
  check(rx.like === "👍 2" && rx.dis === "👎 1" && rx.temp === "37.1°C", `처음: 좋아요 2 · 싫어요 1 → 매너온도 ${rx.temp} (36.5 + 0.5 + 0.4 − 0.3)`, "처음 좋아요: " + JSON.stringify(rx));
  check(await js(`${Q(rb("cj", "like"))}.disabled && ${Q(rb("cj", "dislike"))}.disabled && !${Q(rb("cr", "like"))}.disabled`), "내 댓글(지민)에는 좋아요/싫어요가 눌러지지 않고, 사장님 답글에는 눌러짐", "내 댓글 단추 상태가 이상함");
  await click(rb("cr", "like"));
  rx = await react();
  check(rx.like === "👍 3" && rx.onLike && rx.temp === "37.3°C", `[좋아요]를 누르면 3 이 되고 매너온도 ${rx.temp} (+0.2)`, "좋아요 누름: " + JSON.stringify(rx));
  await shot("8-2-좋아요");
  await click(rb("cr", "like"));
  rx = await react();
  check(rx.like === "👍 2" && !rx.onLike && rx.temp === "37.1°C", "한 번 더 누르면 취소되어 2 로 돌아옴 (한 사람 한 번)", "좋아요 취소: " + JSON.stringify(rx));
  await click(rb("cr", "dislike"));
  rx = await react();
  check(rx.dis === "👎 2" && rx.onDis && rx.temp === "36.8°C", `[싫어요]를 누르면 싫어요 2, 매너온도 ${rx.temp} (−0.3)`, "싫어요 누름: " + JSON.stringify(rx));
  await click(rb("cr", "like"));
  rx = await react();
  st = await stored();
  const crS = st.reviews[0].comments.find((c) => c.id === "cr");
  check(rx.like === "👍 3" && rx.dis === "👎 1" && rx.temp === "37.3°C" && crS.likes.includes("o-지민") && !crS.dislikes.includes("o-지민"),
    "싫어요를 누른 뒤 좋아요를 누르면 싫어요는 빠지고 좋아요로 바뀜 (한 사람이 둘 다 누를 수 없음)", "좋아요로 바꿈: " + JSON.stringify(rx));
  const own = await js(`Store.react(${JSON.stringify(rF.id)}, "cj", "like")`);
  check(own.ok === false && own.message.includes("내 댓글"), "코드로 억지로 내 댓글에 눌러도 막힘: \"" + own.message + "\"", "내 댓글 좋아요: " + JSON.stringify(own));

  // (g) 사장님 본인 화면: 내 프로필 · 목록 · 이름 바꾸기
  await openApp({ seed: sdF, hash: "#/me" });
  d = await js(`({ items: [...document.querySelectorAll("#owned-list li")].map((li) => li.innerText.replace(/\\s+/g, " ")), temp: ${Q("#owner-panel .temp-num")}.innerText, detail: ${Q("#owner-panel .temp-detail")}.innerText })`);
  check(d.items.join() === "골목 치킨 리뷰 2개 · 평균 2.5점" && d.temp === "37.1°C" && d.detail === "답글 단 리뷰 1개 · 좋아요 2 · 싫어요 1",
    `내 프로필에 내 가게와 매너온도가 보임: ${d.items[0]} · ${d.temp} (${d.detail})`, "내 프로필 내 가게: " + JSON.stringify(d));
  await shot("8-2-내프로필-매너온도");
  await go("#/");
  check((await js(`${Q(".owner-tag")}.innerText`)).includes("사장님 등록 · 매너온도 37.1°C"), "목록의 가게 카드에도 사장님 매너온도(37.1°C)가 보임", "카드 매너온도: " + (await js(`${Q(".owner-tag")}?.innerText`)));
  await js(`Store.saveProfile({ name: "사장님새이름", emoji: "🦊", color: "#a0c4ff" })`);
  st = await stored();
  check(st.owners["골목 치킨"].owner.name === "사장님새이름" && st.reviews[0].comments.find((c) => c.id === "cr").author.name === "사장님새이름",
    "프로필 이름을 바꾸면 주인 이름과 사장님 답글의 이름도 같이 바뀜", "이름 바꾼 뒤: " + JSON.stringify(st.owners));

  // (h) 이상한 저장 내용에도 안 깨지는지
  await openApp({ seed: { ...seedData(null), owners: { "x": "이상함", "y": { name: "", owner: {} }, "z": null }, reviews: seedData(null).reviews.map((r) => ({ ...r, comments: r.comments.map((c) => ({ ...c, likes: "이상함", dislikes: [1, null, "a"] })) })) }, hash: "#/" });
  check(await js(`document.querySelectorAll(".shop-card").length === 4`), "주인 · 좋아요 칸에 이상한 값이 들어 있어도 화면이 그대로 나옴", "이상한 저장 내용에서 화면이 깨짐");

  // 10. 이상한 글
  console.log("[이상한 글]");
  const evil = seedData(null);
  evil.reviews[0].text = '<img src=x onerror="window.__hacked=1"><b>굵게</b> & "따옴표"';
  evil.reviews[0].shop = "<script>window.__hacked=1</script>가게";
  evil.reviews[0].comments = [{ id: "ce", text: "<i>기울임</i>", createdAt: T0, author: { ...me, name: "<u>이름</u>" } }];
  await openApp({ seed: evil, hash: "#/shop/" + encodeURIComponent(evil.reviews[0].shop.toLowerCase()) });
  d = await js(`({ hacked: !!window.__hacked, tags: document.querySelectorAll(".review .r-text b, .review .r-text img, .c-text i, .c-head u").length,
    text: ${Q(".r-text")}.innerText, name: ${Q(".shop-name")}.innerText })`);
  check(!d.hacked && d.tags === 0 && d.text.includes("<b>굵게</b>") && d.name.startsWith("<script>"),
    "HTML 태그가 들어간 글 · 가게 · 이름도 그냥 글자로 보이고 실행되지 않음", "이상한 글: " + JSON.stringify(d));

  // 11. 화면 폭
  console.log("[화면 폭]");
  const long = seedData(photoUrl);
  long.reviews.unshift(
    rev("아주아주아주아주긴가게이름아주아주아주아주긴가게이름", "엄청나게긴메뉴이름엄청나게긴메뉴이름엄청나게긴", 5, "ㅋ".repeat(150) + " https://example.com/" + "a".repeat(120), { id: "o-x", name: "열두글자이름열두글자이름", emoji: "🦁", color: "#ffc6ff" }, 10, {
      photo: photoUrl, comments: [{ id: "cl", text: "b".repeat(180), createdAt: T0, author: other("지민") }] }),
  );
  const lo2 = { id: "o-x", name: "열두글자이름열두글자이름", emoji: "🦁", color: "#ffc6ff" };
  long.owners = {
    [Store_key(long.reviews[0].shop)]: { name: long.reviews[0].shop, registeredAt: T0, owner: lo2 },
    "등록만한가게이름등록만한가게이름등록만한가게이름": { name: "등록만한가게이름등록만한가게이름등록만한가게이름", registeredAt: T0, owner: { ...lo2, id: "o-y" } },
  };
  long.reviews[0].comments.push({ id: "cown", text: "c".repeat(150), createdAt: T0, author: lo2, owner: true, likes: ["o-a", "o-b"], dislikes: ["o-c"] });
  const SIZES = [[320, 568, true, "작은 폰"], [390, 844, true, "폰"], [768, 1024, true, "태블릿"], [1280, 800, false, "노트북"], [1920, 1080, false, "큰 모니터"]];
  const FIT = `(() => {
    const W = document.documentElement.clientWidth, out = [];
    document.querySelectorAll("body *").forEach((el) => {
      if (el.offsetParent === null && !["BODY", "MAIN"].includes(el.tagName) && getComputedStyle(el).position !== "fixed") return;
      const r = el.getBoundingClientRect();
      if (r.width && (r.left < -0.5 || r.right > W + 0.5)) out.push((el.id || el.className || el.tagName) + " " + Math.round(r.left) + "~" + Math.round(r.right));
    });
    return { W, scrollW: document.documentElement.scrollWidth, out: out.slice(0, 4) };
  })()`;
  const longKey = encodeURIComponent(Store_key(long.reviews[0].shop));
  function Store_key(s) { return s.trim().replace(/\s+/g, " ").toLowerCase(); }
  const VIEWS = [["목록", "#/"], ["가게", "#/shop/" + longKey], ["리뷰쓰기", "#/write?shop=" + encodeURIComponent(long.reviews[0].shop)], ["내프로필", "#/me"]];
  for (const [w, h, mobile, name] of SIZES) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    for (const [label, hash] of VIEWS) {
      const s = label === "내프로필" ? { ...long, reviews: [{ ...long.reviews[0], author: me }, ...long.reviews.slice(1)] } : long;
      await openApp({ seed: s, hash });
      await sleep(150);
      const f = await js(FIT);
      await shot(`11-${name}${w}-${label}`);
      check(f.scrollW <= f.W && f.out.length === 0, `${name} ${w}×${h} (${label}): 옆으로 밀리거나 잘린 것 없음`,
        `${name} ${w}×${h} (${label}): 페이지 폭 ${f.scrollW} > 화면 ${f.W}, 넘친 것: ${f.out.join(", ") || "없음"}`);
    }
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await openApp({ seed: long, hash: "#/" });
  await js(`localStorage.setItem(${JSON.stringify(SESSION)}, JSON.stringify({ at: 1 }))`);
  await openApp({ keep: true, hash: "#/" });
  for (const w of [320, 390]) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: 700, deviceScaleFactor: 2, mobile: true });
    await sleep(100);
    const fo = await js(FIT); await shot(`11-로그아웃단추-${w}`);
    const bt = await js(`(() => { const r = document.getElementById("logout-btn").getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0 && r.height > 0; })()`);
    check(fo.scrollW <= fo.W && fo.out.length === 0 && bt, `폰 ${w} 화면에서도 [로그아웃] 단추가 잘리지 않음`, `폰 ${w} 로그아웃 단추: ${JSON.stringify(fo)} ${bt}`);
  }
  await js(`localStorage.removeItem(${JSON.stringify(SESSION)})`);
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await openApp({ seed: long, hash: "#/" });
  const slotPhone = await js(`(() => { const r = document.getElementById("login-slot").getBoundingClientRect(); return r.top < 120 && r.right <= innerWidth && r.height > 0; })()`);
  check(slotPhone, "폰 화면에서도 \"로그인 자리\"가 위쪽에 온전히 보임", "폰에서 로그인 자리가 이상함");

  // 12. 오류
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
console.log("이 도구로 확인 못 하는 것: 실제 폰에서 손으로 만졌을 때 느낌, 폰 카메라로 찍은 진짜 사진(HEIC 등), 여러 사람이 쓸 때의 모습(로그인 · 보관함을 붙인 뒤에 확인), 맛 평가가 정직한지\n");
process.exit(bad.length ? 1 : 0);
