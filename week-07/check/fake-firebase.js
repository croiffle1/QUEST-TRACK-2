// 확인 도구 전용 가짜 Firebase. 진짜 Firebase(app · auth · firestore)와 같은 이름의 함수를 흉내 낸다.
// 보관함은 메모리 + 이 브라우저의 localStorage("fake-db")에, 로그인한 사람은 "fake-auth"에 둔다. (진짜 서버에는 아무것도 보내지 않는다)
// 조절 칸(localStorage): fake-next-uid = 다음 팝업에서 로그인할 사람 번호, fake-popup = "blocked" 면 팝업 막힘, fake-deny = "1" 이면 쓰기 거절
const G = globalThis;
if (!G.__fakeFb) {
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };
  const db = JSON.parse(ls.get("fake-db") || "{}");
  const save = () => ls.set("fake-db", JSON.stringify(db));
  const listeners = new Set();
  const notify = () => { for (const l of [...listeners]) l(); };
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  let user = ls.get("fake-auth") ? { uid: ls.get("fake-auth") } : null;
  const authCbs = new Set();
  G.__fakeFb = { db, save, listeners, notify, err, ls, authCbs, getUser: () => user, setUser: (u) => { user = u; if (u) ls.set("fake-auth", u.uid); else ls.del("fake-auth"); for (const cb of [...authCbs]) cb(u); } };
}
const F = G.__fakeFb;

export const initializeApp = () => ({ fake: true });
export const getAuth = () => ({ get currentUser() { return F.getUser(); } });
export const onAuthStateChanged = (auth, cb) => { F.authCbs.add(cb); setTimeout(() => cb(F.getUser()), 10); return () => F.authCbs.delete(cb); };
export class GoogleAuthProvider {}
export const signInWithPopup = async () => {
  if (F.ls.get("fake-popup") === "blocked") throw F.err("auth/popup-blocked", "popup blocked");
  const uid = F.ls.get("fake-next-uid") || "userA";
  F.setUser({ uid });
  // 진짜 로그인은 이름과 메일을 돌려주지만, 작품은 이것을 저장하면 안 된다 (확인 도구가 보관함에서 찾아본다)
  return { user: { uid, displayName: "Kim Realname", email: "realperson@example.com", photoURL: "https://example.com/p.png" } };
};
export const signOut = async () => { F.setUser(null); };

export const getFirestore = () => ({ fake: true });
export const collection = (_db, name) => ({ kind: "col", name });
let autoN = 0;
export const doc = (a, name, id) => (a && a.kind === "col" ? { kind: "doc", col: a.name, id: "auto" + Date.now().toString(36) + (autoN++) } : { kind: "doc", col: name, id });
const snapDoc = (col, id) => ({ id, data: () => JSON.parse(JSON.stringify(F.db[col][id])) });
const writeCheck = (op, ref) => {
  if (F.ls.get("fake-deny") === "1") throw F.err("permission-denied", "denied");
  const u = F.getUser();
  if (!u) throw F.err("permission-denied", "not signed in");
  if (ref.col === "reviews" && op === "set" && !ref.id.startsWith(u.uid + "_")) throw F.err("permission-denied", "review name must start with my uid");
};
const apply = (op, ref, data) => {
  F.db[ref.col] = F.db[ref.col] || {};
  const t = F.db[ref.col];
  if (op === "delete") delete t[ref.id];
  else if (op === "update") { if (!t[ref.id]) throw F.err("not-found", "no doc"); t[ref.id] = { ...t[ref.id], ...JSON.parse(JSON.stringify(data)) }; }
  else {
    if (ref.col === "reviews" && t[ref.id]) { /* 같은 이름으로 다시 만들기는 고치기와 같다 */ }
    t[ref.id] = JSON.parse(JSON.stringify(data));
  }
};
export const getDoc = async (ref) => { const d = (F.db[ref.col] || {})[ref.id]; return { exists: () => !!d, data: () => JSON.parse(JSON.stringify(d)) }; };
export const setDoc = async (ref, data) => { writeCheck("set", ref); apply("set", ref, data); F.save(); F.notify(); };
export const deleteDoc = async (ref) => { writeCheck("delete", ref); apply("delete", ref); F.save(); F.notify(); };
export const writeBatch = () => {
  const ops = [];
  const b = {
    set: (ref, data) => { ops.push(["set", ref, data]); return b; },
    update: (ref, data) => { ops.push(["update", ref, data]); return b; },
    delete: (ref) => { ops.push(["delete", ref]); return b; },
    commit: async () => { for (const [op, ref] of ops) writeCheck(op, ref); for (const [op, ref, data] of ops) apply(op, ref, data); F.save(); F.notify(); },
  };
  return b;
};
export const onSnapshot = (colRef, cb) => {
  const fire = () => cb({ docs: Object.keys(F.db[colRef.name] || {}).map((id) => snapDoc(colRef.name, id)) });
  F.listeners.add(fire); setTimeout(fire, 20);
  return () => F.listeners.delete(fire);
};
