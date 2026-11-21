// 맛집 평점판 확인 도구 (로그인 + 보관함 버전)
// 쓰는 법 (QUEST-TRACK-2 폴더에서):  node week-07/check/check.mjs
// Edge(없으면 Chrome)를 화면 없이 띄워 작품을 열고 사람이 하듯 눌러 본다. 사진은 check/shots/ 에 생긴다. (커밋 안 함)
//
// 진짜 Google 로그인과 진짜 Firebase 는 자동으로 쓸 수 없어서, Firebase 를 같은 모양의 가짜(fake-firebase.js)로 바꿔 끼운다.
// 그래서 이 도구는 "작품이 로그인 · 보관함을 제대로 부르는지"를 확인한다.
// 진짜 Firebase 연결 · 콘솔 설정(Google 로그인 켜기, 승인된 도메인) · 보안 규칙이 실제로 먹는지는 확인하지 못한다. (GitHub Pages 에서 직접 확인)

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEEK = resolve(HERE, "..");
const SHOTS = join(HERE, "shots");
const TMP = join(HERE, ".browser-tmp");
const PORT = 9337, WEB = 8137;
const FAKE = readFileSync(join(HERE, "fake-firebase.js"));

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];
const ok = [], bad = [];
const pass = (t) => { ok.push(t); console.log("  ✅ " + t); };
const fail = (t) => { bad.push(t); console.log("  ❌ " + t); };
const check = (c, g, b) => (c ? pass(g) : fail(b));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browserPath = BROWSERS.find(existsSync);
if (!browserPath) { console.log("Edge 나 Chrome 을 찾지 못했어요."); process.exit(1); }

rmSync(SHOTS, { recursive: true, force: true }); mkdirSync(SHOTS, { recursive: true }); rmSync(TMP, { recursive: true, force: true });

// 작품 파일을 내주는 작은 서버 (file:// 로는 모듈이 안 열린다)
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const server = createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname.replace(/^\/+/, "") || "index.html";
  const f = resolve(WEEK, p);
  if (!f.startsWith(WEEK) || /check/.test(p) || !existsSync(f) || !/\.(html|js)$/.test(f)) { res.writeHead(404); res.end("no"); return; }
  res.writeHead(200, { "content-type": MIME[f.slice(f.lastIndexOf("."))] }); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(WEB, "127.0.0.1", r));
const URL0 = `http://127.0.0.1:${WEB}/index.html`;

const browser = spawn(browserPath, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${TMP}`,
  "--window-size=1280,800", "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });

let ws, nextId = 1;
const waiting = new Map();
const consoleErrors = [], fetchedFirebase = [];

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, no) => waiting.set(id, { ok, no }));
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
          if (m.method === "Fetch.requestPaused") {
            const u = m.params.request.url;
            if (u.startsWith("https://www.gstatic.com/firebasejs/")) {   // 진짜 Firebase 대신 가짜를 내준다
              fetchedFirebase.push(u);
              send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "text/javascript" }, { name: "access-control-allow-origin", value: "*" }], body: FAKE.toString("base64") }).catch(() => {});
            } else send("Fetch.continueRequest", { requestId: m.params.requestId }).catch(() => {});
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
async function js(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function shot(name) { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.data, "base64")); }
const text = (sel) => js(`${Q(sel)}?.innerText.trim() ?? null`);
const exists = (sel) => js(`!!${Q(sel)}`);
const click = (sel) => js(`(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); ${Q(sel)}.click(); })()`);   // 진짜 클릭처럼 쓰던 칸에서 먼저 벗어난다
const setVal = (sel, v) => js(`(() => { const e = ${Q(sel)}; e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); })()`);
const submit = (sel) => js(`${Q(sel)}.requestSubmit()`);
async function until(expr, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { try { if (await js(expr)) return true; } catch {} await sleep(60); } return false; }
const body = () => js("document.body.innerText");
const setLS = (k, v) => js(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
const slotText = () => text("#login-slot");
const dbNow = () => js("JSON.parse(localStorage.getItem('fake-db') || '{}')");
const hash = async (h) => { await js(`location.hash = ${JSON.stringify(h)}`); await sleep(350); };
async function open(h = "") {                 // 새로 열기 (다른 기기에서 여는 것과 비슷)
  await send("Page.navigate", { url: URL0 });
  await sleep(300);
  await send("Page.navigate", { url: URL0 + h });
  await sleep(300);
  await send("Page.reload", {});
  return until("!!window.Store && Store.status().ready && !document.querySelector('#loading')", 8000);
}

try {
  await connect();
  await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "https://www.gstatic.com/*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  console.log("\n① 처음 열기 (로그인 안 한 사람)");
  await send("Page.navigate", { url: URL0 }); await sleep(400);
  await js("localStorage.clear()");
  check(await open(), "화면이 열리고 보관함 준비가 끝났어요", "화면이 준비되지 않았어요");
  check(fetchedFirebase.some((u) => u.endsWith("firebase-auth.js")) && fetchedFirebase.some((u) => u.endsWith("firebase-firestore.js")), "Firebase 로그인 · 보관함 도구를 부르고 있어요 (가짜로 바꿔 끼움)", "Firebase 도구를 부르지 않아요");
  check((await slotText()) === "Google 로 로그인", `로그인 자리에 [Google 로 로그인] 단추: "${await slotText()}"`, `로그인 단추가 없어요: "${await slotText()}"`);
  check(!(await exists("#logout-btn")), "로그아웃 단추는 로그인 전에는 안 보여요", "로그인 전인데 로그아웃 단추가 있어요");
  await shot("1-처음");

  console.log("\n② 로그인 전에는 쓰기가 막히고 안내가 나오는지");
  await hash("#/write");
  check(await exists("#need-login .login-btn"), "리뷰 쓰기: 로그인 안내와 로그인 단추가 나와요", "리뷰 쓰기에 로그인 안내가 없어요");
  check(!(await exists("#write-form")), "로그인 전에는 리뷰 입력칸이 없어요", "로그인 전인데 입력칸이 있어요");

  console.log("\n③ Google 로그인(팝업) → 별명 정하기");
  await setLS("fake-next-uid", "userA");
  await hash("#/");
  await click("#login-slot .login-btn");
  check(await until("!!document.querySelector('#profile-form')"), "처음 로그인하면 별명 정하기 화면으로 가요", "별명 정하기 화면이 안 나와요");
  check(/Google 이름과 메일은 저장하지 않아요/.test(await body()), "Google 이름 · 메일은 저장하지 않는다고 알려 줘요", "저장 안 한다는 안내가 없어요");
  await setVal("#profile-form [name=name]", "");
  await submit("#profile-form");
  check(/별명을 적어 주세요/.test((await text("#form-msg")) || ""), "별명을 비우면 안내가 나와요", "별명을 비워도 넘어가요");
  await setVal("#profile-form [name=name]", "맛객하나");
  await click(".emoji-btn[data-emoji='🐱']");
  await submit("#profile-form");
  check(await until("!document.querySelector('#profile-form') && !!document.querySelector('#me-name')"), "별명을 정하면 저장되고 처음 화면으로 가요", "별명을 정한 뒤 화면이 이상해요");
  check((await slotText()).includes("맛객하나") && (await exists("#logout-btn")), `위쪽에 내 별명과 [로그아웃]: "${(await slotText()).replace(/\s+/g, " ")}"`, "위쪽에 별명 · 로그아웃이 없어요");
  await shot("3-별명정함");
  await hash("#/write");
  check(await exists("#write-form"), "별명을 정한 뒤에는 리뷰 쓰기 칸이 열려요", "리뷰 쓰기 칸이 안 열려요");

  console.log("\n④ 리뷰 쓰기 · 한 가게에 한 번만 · 평균");
  await setVal("#write-form [name=shop]", "행복 분식"); await setVal("#write-form [name=menu]", "떡볶이");
  await submit("#write-form");
  await sleep(300);
  check(/별점/.test((await text("#form-msg")) || ""), `별점 없이 남기면 안내가 나와요: "${await text("#form-msg")}"`, `별점 없는 저장 안내가 없어요: "${await text("#form-msg")}"`);
  await click(".star-btn[data-v='4']"); await setVal("#write-form [name=text]", "국물이 진해요");
  await submit("#write-form");
  check(await until("/#\\/shop\\//.test(location.hash)"), "리뷰를 남기면 가게 화면으로 가요", "리뷰 뒤 가게 화면으로 안 가요");
  await until("document.querySelectorAll('.review').length === 1");
  const t1 = await body();
  check(t1.includes("4.0") && t1.includes("국물이 진해요"), "가게 화면에 평균 4.0 과 리뷰가 보여요", "평균 · 리뷰가 안 보여요");
  const shopHash = await js("location.hash");
  const docs = await dbNow();
  const rid = Object.keys(docs.reviews || {})[0] || "";
  check(Object.keys(docs.reviews || {}).length === 1 && rid.startsWith("userA_s-"), `보관함의 리뷰 이름이 "내uid_가게번호": ${rid}`, `리뷰 이름이 이상해요: ${rid}`);
  check(docs.reviews?.[rid]?.authorUid === "userA" && docs.reviews?.[rid]?.authorName === "맛객하나", "쓴 사람 칸에 uid 와 별명이 들어가요", "쓴 사람 칸이 이상해요");
  check(Object.keys(docs.users?.userA || {}).sort().join() === "color,emoji,nickname", "내 별명 문서에는 별명 · 그림 · 색만 있어요", `내 별명 문서: ${JSON.stringify(docs.users?.userA)}`);
  const raw = await js("localStorage.getItem('fake-db')");
  check(!/Kim Realname|realperson@example\.com|example\.com\/p\.png/.test(raw), "보관함 어디에도 Google 이름 · 메일 · 사진 주소가 없어요", "Google 이름이나 메일이 보관함에 저장됐어요!");
  await hash("#/write?shop=" + encodeURIComponent("행복분식"));
  check(/이미 이 가게에 내 리뷰/.test(await body()), "같은 가게에 또 쓰려 하면 '이미 내 리뷰가 있어요' 안내", "중복 안내가 없어요");
  await setVal("#write-form [name=menu]", "순대"); await setVal("#write-form [name=text]", "또 쓰기"); await click(".star-btn[data-v='5']"); await submit("#write-form");
  await sleep(500);
  check(Object.keys((await dbNow()).reviews).length === 1, "그래도 두 번째 리뷰는 만들어지지 않아요", "같은 가게에 리뷰가 두 개 생겼어요");
  check(/한 가게에는 한 번만/.test(await body()), "화면에 '한 가게에는 한 번만' 오류 글이 보여요", "중복 오류 글이 없어요");

  console.log("\n⑤ 로그아웃 → 로그인 전에도 읽기는 돼요");
  await hash("#/");
  await click("#logout-btn");
  check(await until("document.querySelector('#login-slot .login-btn')"), "로그아웃하면 다시 [Google 로 로그인] 이 나와요", "로그아웃이 안 돼요");
  check(!(await js("localStorage.getItem('fake-auth')")), "로그인 상태가 지워졌어요", "로그인 상태가 남았어요");
  check(/행복 분식/.test(await body()) && (await body()).includes("4.0"), "로그인 안 해도 가게와 평균이 보여요", "로그아웃하니 가게가 안 보여요");

  console.log("\n⑥ 다른 기기(다른 사람)에서 열기: 같은 기록이 이어서 보이는지");
  check(await open("#/"), "새로 열기", "새로 열었는데 준비가 안 돼요");
  check(/행복 분식/.test(await body()), "새로 열어도 가게가 보여요 (보관함에서 불러옴)", "새로 열면 가게가 사라져요");
  await setLS("fake-next-uid", "userB");
  await click("#login-slot .login-btn");
  await until("!!document.querySelector('#profile-form')");
  await setVal("#profile-form [name=name]", "손님둘"); await submit("#profile-form");
  await until("!!document.querySelector('#me-name')");
  await hash("#/");
  check(/행복 분식/.test(await body()), "다른 사람으로 로그인해도 첫 사람의 리뷰가 보여요", "다른 사람에게 기록이 안 보여요");

  console.log("\n⑦ 두 번째 사람: 같은 가게에 별점 → 평균 · 댓글");
  await hash("#/write?shop=" + encodeURIComponent("행복 분식"));
  await setVal("#write-form [name=menu]", "순대"); await setVal("#write-form [name=text]", "그냥 그래요"); await click(".star-btn[data-v='2']"); await submit("#write-form");
  await until("document.querySelectorAll('.review').length === 2");
  check((await body()).includes("3.0"), "두 사람이 줘서 평균이 3.0 (4점 + 2점)", "평균이 3.0 이 아니에요");
  check((await js("document.querySelectorAll('.edit-btn').length")) === 1, "남의 리뷰에는 고치기 · 지우기가 없고 내 리뷰에만 있어요", "고치기 단추 수가 이상해요");
  await setVal(".c-form [name=text]", "나도 가 봤어!");
  await submit(".c-form");
  await until("document.querySelectorAll('.comment').length === 1");
  check((await body()).includes("나도 가 봤어!"), "댓글이 달려요", "댓글이 안 보여요");
  const c0 = Object.values((await dbNow()).comments || {})[0] || {};
  check(c0.authorUid === "userB" && c0.authorName === "손님둘" && !("displayName" in c0) && !("email" in c0), "댓글에도 uid 와 별명만 들어가요", `댓글 문서: ${JSON.stringify(c0)}`);
  await shot("7-두사람");

  console.log("\n⑧ 첫 번째 사람이 다시 와서 좋아요 · 내 리뷰만 지우기");
  await click("#logout-btn"); await until("document.querySelector('#login-slot .login-btn')");
  await setLS("fake-next-uid", "userA"); await click("#login-slot .login-btn");
  await until("document.querySelector('#me-name')");
  check((await slotText()).includes("맛객하나") && !(await exists("#profile-form")), "다시 로그인하면 저장돼 있던 내 별명이 바로 보여요 (별명을 또 묻지 않음)", `별명이 안 보여요: ${await slotText()}`);
  await hash(shopHash);
  await until("!!document.querySelector(\".react-btn[data-kind='like']:not([disabled])\")", 3000);
  await click(".react-btn[data-kind='like']:not([disabled])"); await sleep(400);
  const rx = Object.values((await dbNow()).reactions || {});
  check(rx.length === 1 && rx[0].uid === "userA" && rx[0].kind === "like", "좋아요가 보관함에 저장돼요 (한 사람 한 번)", `좋아요: ${JSON.stringify(rx)}`);
  await click(".del-btn"); await click(".del-yes"); await sleep(500);
  const afterDel = Object.keys((await dbNow()).reviews);
  check(afterDel.length === 1 && afterDel[0].startsWith("userB_"), "내 리뷰만 지워지고 남의 리뷰는 그대로예요", `지운 뒤: ${afterDel}`);

  console.log("\n⑨ 오류 글: 팝업 막힘 · 저장 권한 없음");
  await click("#logout-btn"); await until("document.querySelector('#login-slot .login-btn')");
  await setLS("fake-popup", "blocked"); await click("#login-slot .login-btn");
  check(await until("!document.querySelector('#banner').hidden"), "팝업이 막히면 오류 글이 떠요", "팝업 막힘인데 오류 글이 없어요");
  check(/팝업/.test((await text("#banner-text")) || ""), `오류 글: "${await text("#banner-text")}"`, `오류 글이 이상해요: ${await text("#banner-text")}`);
  await shot("9-팝업막힘");
  await setLS("fake-popup", "ok");
  await click("#login-slot .login-btn"); await until("document.querySelector('#me-name')");
  check(await js("document.querySelector('#banner').hidden"), "다시 로그인에 성공하면 오류 글이 사라져요", "오류 글이 안 사라져요");
  await setLS("fake-deny", "1");
  await hash("#/write?shop=" + encodeURIComponent("둘째 식당"));
  await setVal("#write-form [name=menu]", "국수"); await setVal("#write-form [name=text]", "저장 거절 시험"); await click(".star-btn[data-v='3']"); await submit("#write-form");
  check(await until("!document.querySelector('#banner').hidden"), "저장이 거절되면 오류 글이 떠요", "저장 실패인데 오류 글이 없어요");
  check(/권한/.test((await text("#banner-text")) || ""), `오류 글: "${await text("#banner-text")}"`, `저장 오류 글이 이상해요: ${await text("#banner-text")}`);
  check(await exists("#write-form"), "저장이 실패해도 쓰던 글은 화면에 남아요", "저장 실패하니 쓰던 글이 사라졌어요");
  await shot("9-저장거절");
  await setLS("fake-deny", "0");

  console.log("\n⑩ 이상한 글 · 화면 폭");
  await click("#banner-close");
  await setVal("#write-form [name=shop]", "<b>태그</b>식당"); await setVal("#write-form [name=menu]", "<i>메뉴</i>"); await setVal("#write-form [name=text]", "<u>글</u>"); await click(".star-btn[data-v='5']"); await submit("#write-form");
  await until("document.querySelectorAll('.review').length === 1");
  check((await body()).includes("<b>태그</b>식당") && !(await js("!!document.querySelector('.review b:not(.r-name)')")), "HTML 태그가 글자 그대로 보여요", "HTML 태그가 먹혀요");
  let overflow = false;
  for (const w of [320, 375, 768, 1280, 1920]) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: 800, deviceScaleFactor: 1, mobile: w < 700 });
    for (const h of ["#/", "#/me", "#/write"]) {
      await hash(h);
      if (await js("document.documentElement.scrollWidth > window.innerWidth + 1")) { overflow = true; fail(`${w}px · ${h}: 옆으로 밀려요`); }
    }
    if (w === 320) { await hash("#/"); await shot("10-폰320"); }
  }
  if (!overflow) pass("화면 폭 320 · 375 · 768 · 1280 · 1920 에서 옆으로 밀리지 않아요 (목록 · 내 프로필 · 리뷰 쓰기)");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  console.log("\n⑪ 글자 검사: 저장 코드 한곳 · Firebase 설정 · 규칙 파일");
  const html = readFileSync(join(WEEK, "index.html"), "utf8"), store = readFileSync(join(WEEK, "store.js"), "utf8"), rules = readFileSync(join(WEEK, "firestore.rules"), "utf8");
  check(!/gstatic|initializeApp|getFirestore|signInWithPopup|localStorage|sessionStorage|indexedDB/.test(html), "index.html 은 Firebase · 브라우저 저장을 직접 쓰지 않아요 (저장 코드는 store.js 한곳)", "index.html 이 Firebase 나 localStorage 를 직접 써요");
  check(/projectId: "matjib-review"/.test(store) && /AIzaSyCFjJ74TLEdppQ_MjvQcZi6zymudzqb0YQ/.test(store) && /1:39390059100:web:a8c713555a6b69b251a499/.test(store), "store.js 에 받은 Firebase 설정값이 들어 있어요", "Firebase 설정값이 없어요");
  check(/signInWithPopup/.test(store) && !/signInWithRedirect/.test(store), "로그인은 새 창(팝업) 방식이에요", "팝업 로그인이 아니에요");
  check(!/displayName|\.email|photoURL/.test(store), "store.js 는 Google 이름 · 메일 · 사진을 읽지 않아요", "store.js 가 Google 이름/메일을 읽어요");
  check(/allow read: if true/.test(rules) && /signedIn\(\)/.test(rules), "규칙: 읽기는 누구나, 쓰기는 로그인한 사람만", "규칙의 읽기/쓰기 약속이 이상해요");
  check(/allow delete: if signedIn\(\) && resource\.data\.authorUid == me\(\)/.test(rules) && /allow delete: if signedIn\(\) && userId == me\(\)/.test(rules), "규칙: 지우기는 자기 것만", "규칙의 지우기 약속이 이상해요");
  check(/match \/users\/\{userId\}[\s\S]*?allow read: if signedIn\(\) && userId == me\(\)/.test(rules), "규칙: 내 별명 문서는 읽기도 나만", "규칙의 users 읽기가 이상해요");
  check(/reviewId == me\(\) \+ '_' \+ request\.resource\.data\.shopId/.test(rules), "규칙: 리뷰 이름이 내uid_가게번호여야 해서 한 가게에 한 번만", "규칙의 한 번만 약속이 없어요");
  check(!/allow (create|update|write|delete)[^;]*: if true;/.test(rules), "규칙: 쓰기 · 지우기에 '누구나' 허용이 없어요", "규칙에 누구나 쓰기 허용이 있어요");

  console.log("\n⑫ 브라우저 오류");
  const real = consoleErrors.filter((e) => !/Failed to load resource/.test(e));
  check(real.length === 0, "브라우저 오류 메시지가 없어요", "브라우저 오류: " + real.slice(0, 5).join(" | "));
} catch (e) {
  fail("확인 도중 멈췄어요: " + (e.stack || e.message));
  try { await shot("오류"); } catch {}
} finally {
  console.log(`\n결과: 통과 ${ok.length} · 실패 ${bad.length}`);
  if (bad.length) console.log("실패한 것:\n - " + bad.join("\n - "));
  try { ws?.close(); } catch {}
  browser.kill(); server.close();
  await sleep(300);
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(bad.length ? 1 : 0);
}
