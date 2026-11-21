// 저장하는 코드는 전부 이 파일에만 있다. (index.html 은 Firebase 를 직접 쓰지 않는다)
// 로그인은 Google 팝업(Firebase Authentication), 기록은 Firestore 에 저장해서 어느 기기에서 열어도 이어서 보인다.
// 누가 읽고 쓸 수 있는지는 week-07/firestore.rules 가 정한다. (그 파일을 Firebase 콘솔에 붙여 넣어야 적용됨)
//
// 저장하는 곳 (Firestore 컬렉션)
//   users/{uid}                  내 별명 · 그림 · 색          (나만 읽고 씀)
//   shops/{가게id}               가게 주인 등록                (가게id = shopKey(가게 이름), 한 가게에 주인 한 명)
//   reviews/{uid}_{가게id}       리뷰 한 개                    (한 사람은 한 가게에 한 번만 → 문서 이름으로 막음)
//   photos/{uid}_{가게id}        리뷰 사진 (줄인 JPEG 글자)    (눌렀을 때만 불러옴)
//   comments/{자동 번호}         댓글 (사장님 답글이면 byOwner: true)
//   reactions/{댓글번호}_{uid}   댓글 좋아요/싫어요            (한 사람이 한 댓글에 한 번)
// 쓴 사람 칸에는 uid 와 별명(authorUid · authorName · authorEmoji · authorColor)만 넣는다.
// Google 이름 · 메일 · 사진 주소는 읽지도 저장하지도 않는다.

const VERSION = "13.4.0";
const BASE = `https://www.gstatic.com/firebasejs/${VERSION}/`;

// 공개해도 되는 이름표(비밀번호나 열쇠가 아님). 나쁜 사람이 못 쓰게 막는 건 firestore.rules 다.
const firebaseConfig = {
  apiKey: "AIzaSyCFjJ74TLEdppQ_MjvQcZi6zymudzqb0YQ",
  authDomain: "matjib-review.firebaseapp.com",
  projectId: "matjib-review",
  storageBucket: "matjib-review.firebasestorage.app",
  messagingSenderId: "39390059100",
  appId: "1:39390059100:web:a8c713555a6b69b251a499",
};

// ── 작은 도우미 ──
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v) => (Number.isFinite(v) ? v : 0);
const cleanAuthor = (id, name, emoji, color) => ({
  id: str(id, 128), name: str(name, 12) || "이름 없음", emoji: str(emoji, 8) || "🙂",
  color: /^#[0-9a-f]{6}$/i.test(color) ? color : "#ffd6a5",
});
// 가게 이름이 같은 가게인지 가르는 기준: 앞뒤 빈칸 없애기, 띄어쓰기 하나로, 영어는 소문자로
const normalizeName = (name) => String(name).trim().replace(/\s+/g, " ").toLowerCase();
// 가게 번호(= Firestore 문서 이름): "s-" + 주소처럼 바꾼 이름. (/ 와 . 때문에 생기는 문제를 막음)
const shopKey = (name) => "s-" + encodeURIComponent(normalizeName(name)).replace(/\./g, "%2E");
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

// ── 상태 ──
const state = { fatal: "", authReady: false, user: null, profile: null, profileFor: "", loaded: { reviews: false, comments: false, reactions: false, shops: false } };
const cache = { reviews: new Map(), comments: new Map(), reactions: new Map(), shops: new Map() };
let derived = { reviews: [], owners: {} };
const changeCbs = new Set(), errorCbs = new Set();
const photoMem = new Map();
let api = null, authToken = 0;

const emit = () => { for (const cb of changeCbs) { try { cb(); } catch (e) { console.error(e); } } };

// 오류를 쉬운 한국어로 바꾼다
function explain(e) {
  const code = (e && e.code) || "";
  const host = typeof location !== "undefined" ? location.host : "";
  const table = {
    "auth/popup-closed-by-user": "로그인 창이 닫혔어요. 다시 눌러 주세요.",
    "auth/cancelled-popup-request": "로그인 창이 이미 열려 있어요. 열린 창에서 계속해 주세요.",
    "auth/popup-blocked": "브라우저가 로그인 창(팝업)을 막았어요. 주소창 옆의 팝업 허용을 누르고 다시 눌러 주세요.",
    "auth/unauthorized-domain": `이 주소(${host})가 Firebase 의 '승인된 도메인'에 없어요. Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에 이 주소를 추가해 주세요.`,
    "auth/operation-not-allowed": "Firebase 콘솔에서 Google 로그인이 아직 켜져 있지 않아요. Authentication → 로그인 방법 → Google 을 사용 설정해 주세요.",
    "auth/network-request-failed": "인터넷 연결을 확인하고 다시 해 주세요.",
    "auth/too-many-requests": "잠깐 너무 많이 시도했어요. 조금 있다가 다시 해 주세요.",
    "permission-denied": "권한이 없어요. 로그인했는지, 그리고 firestore.rules 를 Firebase 콘솔에 붙여 넣어 게시했는지 확인해 주세요.",
    "unavailable": "인터넷 연결이 불안정해서 보관함에 닿지 못했어요. 연결을 확인하고 다시 해 주세요.",
    "unauthenticated": "로그인이 풀렸어요. 다시 로그인해 주세요.",
    "not-found": "보관함(Firestore 데이터베이스)을 찾지 못했어요. Firebase 콘솔에서 데이터베이스를 만들었는지 확인해 주세요.",
    "failed-precondition": "보관함이 아직 준비되지 않았어요. Firebase 콘솔에서 Firestore 데이터베이스를 만들었는지 확인해 주세요.",
    "resource-exhausted": "오늘 쓸 수 있는 보관함 사용량이 다 찼어요. 내일 다시 해 주세요.",
  };
  if (table[code]) return table[code];
  return `문제가 생겼어요${code ? ` (${code})` : ""}${e && e.message ? `: ${String(e.message).slice(0, 120)}` : ""}`;
}
const report = (e) => { const message = typeof e === "string" ? e : explain(e); for (const cb of errorCbs) { try { cb(message); } catch (x) { console.error(x); } } return message; };

// ── 받아 온 것을 화면이 쓰기 쉬운 모양으로 ──
function rebuild() {
  const likes = new Map();                       // 댓글 번호 → { likes: [uid], dislikes: [uid] }
  for (const r of cache.reactions.values()) {
    const cid = str(r.commentId, 200), uid = str(r.uid, 128);
    if (!cid || !uid || (r.kind !== "like" && r.kind !== "dislike")) continue;
    const slot = likes.get(cid) || { likes: [], dislikes: [] };
    (r.kind === "like" ? slot.likes : slot.dislikes).push(uid);
    likes.set(cid, slot);
  }
  const byReview = new Map();
  for (const [id, c] of cache.comments) {
    const text = str(c.text, 400);
    if (!text) continue;
    const slot = likes.get(id) || { likes: [], dislikes: [] };
    const list = byReview.get(str(c.reviewId, 300)) || [];
    list.push({ id, text, createdAt: num(c.createdAt), owner: c.byOwner === true, likes: slot.likes, dislikes: slot.dislikes,
      author: cleanAuthor(c.authorUid, c.authorName, c.authorEmoji, c.authorColor) });
    byReview.set(str(c.reviewId, 300), list);
  }
  const reviews = [];
  for (const [id, r] of cache.reviews) {
    const stars = Math.round(num(r.stars)), shop = str(r.shop, 60).trim(), menu = str(r.menu, 60).trim(), shopId = str(r.shopId, 700);
    if (stars < 1 || stars > 5 || !shop || !menu || !shopId.startsWith("s-")) continue;
    reviews.push({
      id, shop, shopKey: shopId, menu, stars, text: str(r.text, 1000), hasPhoto: r.hasPhoto === true,
      createdAt: num(r.createdAt), editedAt: num(r.editedAt), author: cleanAuthor(r.authorUid, r.authorName, r.authorEmoji, r.authorColor),
      comments: (byReview.get(id) || []).sort((a, b) => a.createdAt - b.createdAt),
    });
  }
  reviews.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
  const owners = {};
  for (const [id, s] of cache.shops) {
    const name = str(s.name, 60).trim();
    if (!id.startsWith("s-") || !name || !str(s.ownerUid, 128)) continue;
    owners[id] = { name, registeredAt: num(s.registeredAt), owner: cleanAuthor(s.ownerUid, s.ownerName, s.ownerEmoji, s.ownerColor) };
  }
  derived = { reviews, owners };
}

const isReady = () => !!state.fatal || (state.authReady && Object.values(state.loaded).every(Boolean));
const waitFor = async (test, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await new Promise((r) => setTimeout(r, 40)); } return false; };

async function loadProfile(uid, token) {
  try {
    const snap = await api.Fs.getDoc(api.Fs.doc(api.db, "users", uid));
    if (token !== authToken) return;
    const d = snap.exists() ? snap.data() : null;
    state.profile = d && str(d.nickname, 12) ? cleanAuthor(uid, d.nickname, d.emoji, d.color) : null;
  } catch (e) { if (token === authToken) report(e); }
  if (token === authToken) state.profileFor = uid;
}

function start() {
  const { auth, db, Au, Fs } = api;
  Au.onAuthStateChanged(auth, async (u) => {
    const token = ++authToken;
    state.user = u ? { uid: u.uid } : null; state.profile = null; state.profileFor = "";
    if (u) await loadProfile(u.uid, token);
    if (token !== authToken) return;
    state.authReady = true; rebuild(); emit();
  }, (e) => { state.authReady = true; report(e); emit(); });
  for (const name of Object.keys(cache)) {
    Fs.onSnapshot(Fs.collection(db, name), (snap) => {
      cache[name] = new Map(snap.docs.map((d) => [d.id, d.data()]));
      state.loaded[name] = true; rebuild(); emit();
    }, (e) => { state.loaded[name] = true; report(e); emit(); });
  }
}

// Firebase 가져오기 (인터넷이 안 되면 화면에 까닭을 보여 주고 빈 보관함처럼 동작)
try {
  const [A, Au, Fs] = await Promise.all([import(BASE + "firebase-app.js"), import(BASE + "firebase-auth.js"), import(BASE + "firebase-firestore.js")]);
  const app = A.initializeApp(firebaseConfig);
  api = { auth: Au.getAuth(app), db: Fs.getFirestore(app), Au, Fs };
  start();
} catch (e) {
  state.fatal = "Firebase 를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.";
  state.authReady = true; for (const k of Object.keys(state.loaded)) state.loaded[k] = true;
  console.warn("Firebase 불러오기 실패:", e && e.message);
}

// ── 쓰기 도우미 ──
const fail = (message, extra = {}) => ({ ok: false, message, ...extra });
function guard(needProfile = true) {
  if (state.fatal) return fail(state.fatal);
  if (!state.user) return fail("먼저 Google 로 로그인해 주세요.");
  if (needProfile && !state.profile) return fail("먼저 별명을 정해 주세요.");
  return null;
}
async function run(fn) { try { return await fn(); } catch (e) { return fail(explain(e), { code: (e && e.code) || "" }); } }
const author = () => ({ authorUid: state.user.uid, authorName: state.profile.name, authorEmoji: state.profile.emoji, authorColor: state.profile.color });
const chunks = (list, n = 400) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

export const Store = {
  normalizeName, shopKey,
  onChange: (cb) => { changeCbs.add(cb); return () => changeCbs.delete(cb); },
  onError: (cb) => { errorCbs.add(cb); return () => errorCbs.delete(cb); },
  explain,
  status: () => ({ ready: isReady(), fatal: state.fatal }),
  getUser: () => state.user,
  getProfile: () => state.profile,           // 로그인했고 별명을 정했을 때만 { id, name, emoji, color }
  getReviews: () => derived.reviews,
  getOwners: () => derived.owners,

  // ── 로그인 · 로그아웃 (Google 팝업) ──
  async login() {
    if (state.fatal) return fail(state.fatal);
    return run(async () => {
      const { auth, Au } = api;
      await Au.signInWithPopup(auth, new Au.GoogleAuthProvider());
      await waitFor(() => state.user && state.profileFor === state.user.uid);   // 내 별명까지 불러오기
      return { ok: true, hasProfile: !!state.profile };
    });
  },
  async logout() {
    if (state.fatal) return fail(state.fatal);
    return run(async () => { await api.Au.signOut(api.auth); return { ok: true }; });
  },

  // ── 별명 · 그림 (처음 로그인할 때 정함). 고치면 내가 쓴 리뷰 · 댓글 · 내 가게의 이름도 같이 바뀐다. ──
  async saveProfile({ name, emoji, color }) {
    const g = guard(false); if (g) return g;
    const me = cleanAuthor(state.user.uid, name, emoji, color);
    return run(async () => {
      const { db, Fs } = api, had = state.profile;
      await Fs.setDoc(Fs.doc(db, "users", me.id), { nickname: me.name, emoji: me.emoji, color: me.color });
      state.profile = me; state.profileFor = me.id;
      if (had) {
        const ops = [];
        for (const [id, r] of cache.reviews) if (r.authorUid === me.id) ops.push([Fs.doc(db, "reviews", id), { authorName: me.name, authorEmoji: me.emoji, authorColor: me.color }]);
        for (const [id, c] of cache.comments) if (c.authorUid === me.id) ops.push([Fs.doc(db, "comments", id), { authorName: me.name, authorEmoji: me.emoji, authorColor: me.color }]);
        for (const [id, s] of cache.shops) if (s.ownerUid === me.id) ops.push([Fs.doc(db, "shops", id), { ownerName: me.name, ownerEmoji: me.emoji, ownerColor: me.color }]);
        for (const part of chunks(ops)) { const b = Fs.writeBatch(db); for (const [ref, data] of part) b.update(ref, data); await b.commit(); }
      }
      rebuild(); emit();
      return { ok: true, value: me };
    });
  },

  // ── 리뷰: 한 사람은 한 가게에 한 번만 (문서 이름 = uid_가게id) ──
  async addReview({ shop, menu, stars, text, photo }) {
    const g = guard(); if (g) return g;
    const name = str(shop, 60).trim().replace(/\s+/g, " "), dish = str(menu, 60).trim();
    if (!name || !dish) return fail("가게와 메뉴를 적어 주세요.");
    const shopId = shopKey(name), id = `${state.user.uid}_${shopId}`;
    if (cache.reviews.has(id)) return fail("이미 이 가게에 리뷰를 남겼어요. 한 가게에는 한 번만 별점을 줄 수 있어요.", { duplicate: id });
    return run(async () => {
      const { db, Fs } = api, b = Fs.writeBatch(db);
      b.set(Fs.doc(db, "reviews", id), {
        shop: name, shopId, menu: dish, stars: Math.min(5, Math.max(1, Math.round(stars))), text: str(text, 1000),
        hasPhoto: !!photo, createdAt: Date.now(), ...author(),
      });
      if (photo) b.set(Fs.doc(db, "photos", id), { uid: state.user.uid, data: photo });
      await b.commit();
      if (photo) photoMem.set(id, photo);
      return { ok: true, value: id };
    });
  },
  // 내가 쓴 리뷰 고치기. 가게는 못 바꾼다. photo: undefined 는 그대로, null 은 사진 빼기, 글자는 새 사진
  async updateReview(id, { menu, stars, text, photo }) {
    const g = guard(); if (g) return g;
    const r = cache.reviews.get(id);
    if (!r) return fail("그 리뷰를 찾지 못했어요.");
    if (r.authorUid !== state.user.uid) return fail("내가 쓴 리뷰만 고칠 수 있어요.");
    return run(async () => {
      const { db, Fs } = api, b = Fs.writeBatch(db);
      const hasPhoto = photo === undefined ? r.hasPhoto === true : !!photo;
      b.update(Fs.doc(db, "reviews", id), {
        menu: str(menu, 60).trim() || r.menu, stars: Math.min(5, Math.max(1, Math.round(stars))), text: str(text, 1000), hasPhoto, editedAt: Date.now(),
      });
      if (photo) b.set(Fs.doc(db, "photos", id), { uid: state.user.uid, data: photo });
      else if (photo === null && r.hasPhoto === true) b.delete(Fs.doc(db, "photos", id));
      await b.commit();
      if (photo) photoMem.set(id, photo); else if (photo === null) photoMem.delete(id);
      return { ok: true, value: id };
    });
  },
  // 내가 쓴 리뷰 지우기 (사진도 같이). 남이 단 댓글은 내가 지울 수 없어서 남지만, 리뷰가 없으면 화면에 안 나온다.
  async deleteReview(id) {
    const g = guard(); if (g) return g;
    const r = cache.reviews.get(id);
    if (!r) return fail("그 리뷰를 찾지 못했어요.");
    if (r.authorUid !== state.user.uid) return fail("내가 쓴 리뷰만 지울 수 있어요.");
    return run(async () => {
      const { db, Fs } = api, b = Fs.writeBatch(db);
      b.delete(Fs.doc(db, "reviews", id));
      if (r.hasPhoto === true) b.delete(Fs.doc(db, "photos", id));
      await b.commit(); photoMem.delete(id);
      return { ok: true };
    });
  },
  // 사진은 리뷰를 눌렀을 때만 불러온다
  async getPhoto(id) {
    if (photoMem.has(id)) return { ok: true, value: photoMem.get(id) };
    if (state.fatal) return fail(state.fatal);
    return run(async () => {
      const snap = await api.Fs.getDoc(api.Fs.doc(api.db, "photos", id));
      const d = snap.exists() ? snap.data() : null;
      const value = d && typeof d.data === "string" && PHOTO_RE.test(d.data) ? d.data : null;
      if (value) photoMem.set(id, value);
      return { ok: true, value };
    });
  },

  // ── 댓글 · 좋아요/싫어요 ──
  async addComment(reviewId, text) {
    const g = guard(); if (g) return g;
    const r = cache.reviews.get(reviewId);
    if (!r) return fail("그 리뷰를 찾지 못했어요.");
    const body = str(text, 400).trim();
    if (!body) return fail("댓글을 적어 주세요.");
    const shop = cache.shops.get(r.shopId);
    return run(async () => {
      const { db, Fs } = api, ref = Fs.doc(Fs.collection(db, "comments"));
      await Fs.setDoc(ref, { reviewId, shopId: r.shopId, text: body, createdAt: Date.now(), byOwner: !!shop && shop.ownerUid === state.user.uid, ...author() });
      return { ok: true, value: ref.id };
    });
  },
  // 같은 걸 또 누르면 취소, 다른 걸 누르면 바뀜. 내 댓글에는 못 누른다. (문서 이름 = 댓글번호_uid 라서 한 사람 한 번)
  async react(reviewId, commentId, kind) {
    const g = guard(); if (g) return g;
    if (kind !== "like" && kind !== "dislike") return fail("알 수 없는 단추예요.");
    const c = cache.comments.get(commentId);
    if (!c) return fail("그 댓글을 찾지 못했어요.");
    if (c.authorUid === state.user.uid) return fail("내 댓글에는 누를 수 없어요.");
    const id = `${commentId}_${state.user.uid}`, had = cache.reactions.get(id);
    return run(async () => {
      const { db, Fs } = api, ref = Fs.doc(db, "reactions", id);
      if (had && had.kind === kind) await Fs.deleteDoc(ref);
      else await Fs.setDoc(ref, { commentId, uid: state.user.uid, kind });
      return { ok: true };
    });
  },

  // ── 가게 주인 등록: 한 가게에 주인은 한 명 (먼저 등록한 사람). 진짜 주인인지 확인하는 방법은 아직 없다. ──
  async registerShop(name) {
    const g = guard(); if (g) return g;
    const shop = str(name, 30).trim().replace(/\s+/g, " ");
    if (!shop) return fail("가게 이름을 적어 주세요.");
    const id = shopKey(shop), have = cache.shops.get(id);
    if (have) return fail(have.ownerUid === state.user.uid ? "이미 내 가게로 등록돼 있어요." : "이미 주인이 등록된 가게예요.");
    const same = derived.reviews.filter((r) => r.shopKey === id);           // 새 리뷰가 앞이라 마지막이 처음 적은 이름
    return run(async () => {
      const { db, Fs } = api;
      await Fs.setDoc(Fs.doc(db, "shops", id), {
        name: same.length ? same[same.length - 1].shop : shop, registeredAt: Date.now(),
        ownerUid: state.user.uid, ownerName: state.profile.name, ownerEmoji: state.profile.emoji, ownerColor: state.profile.color,
      });
      return { ok: true, value: id };
    });
  },
};
globalThis.Store = Store;      // 확인 도구가 쓴다
