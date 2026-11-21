// 저장하는 코드는 전부 이 파일에만 있다. (index.html 은 localStorage 를 직접 쓰지 않는다)
// 지금은 이 기기의 브라우저(localStorage)에 저장한다.
// 나중에 로그인과 보관함(데이터베이스)을 붙일 때는 이 파일 안쪽만 바꾸면 된다.
//
// 저장하는 모양 ("pt-matjip-v1" 한 칸에 통째로):
//   { profile: { id, name, emoji, color } | null,
//     reviews: [ { id, shop, menu, stars(1~5), text, photo(data:image/… 또는 null), createdAt, editedAt(고친 때, 없으면 0),
//                  author: { id, name, emoji, color },
//                  comments: [ { id, text, createdAt, author: { id, name, emoji, color },
//                                owner(사장님이 자기 가게 리뷰에 단 답글이면 true), likes: [누른 사람 id], dislikes: [누른 사람 id] } ] } ]  // 새 리뷰가 맨 앞
//     owners: { "<가게 key>": { name, registeredAt, owner: { id, name, emoji, color } } }   // 가게 주인 등록
//   }
// 가게는 따로 저장하지 않는다. 리뷰에 적힌 가게 이름이 같으면 같은 가게로 묶는다. (shopKey)

const Store = (() => {
  const KEY = "pt-matjip-v1";
  const SESSION_KEY = "pt-matjip-session";   // 로그인한 상태 (로그인은 아직 없어서 지금은 아무도 이 칸을 채우지 않는다)

  const keyOf = (name) => String(name).trim().replace(/\s+/g, " ").toLowerCase();
  const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x).map((x) => x.slice(0, 60)))].slice(0, 500) : []);
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const cleanAuthor = (a) => ({
    id: str(a && a.id, 60), name: str(a && a.name, 12) || "이름 없음",
    emoji: str(a && a.emoji, 8) || "🙂", color: /^#[0-9a-f]{6}$/i.test(a && a.color) ? a.color : "#ffd6a5",
  });

  // 저장돼 있던 것을 읽는다. 망가진 것은 버리고, 없으면 빈 상태로 시작한다.
  function read() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (e) { raw = null; }
    const out = { profile: null, reviews: [], owners: {} };
    if (!raw || typeof raw !== "object") return out;
    if (raw.profile && typeof raw.profile === "object") out.profile = cleanAuthor(raw.profile);
    if (Array.isArray(raw.reviews)) {
      for (const r of raw.reviews) {
        if (!r || typeof r !== "object") continue;
        const stars = Math.round(num(r.stars));
        const shop = str(r.shop, 60).trim(), menu = str(r.menu, 60).trim();
        if (stars < 1 || stars > 5 || !shop || !menu) continue;
        out.reviews.push({
          id: str(r.id, 60) || newId(), shop, menu, stars, text: str(r.text, 1000),
          photo: typeof r.photo === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.photo) ? r.photo : null,
          createdAt: num(r.createdAt), editedAt: num(r.editedAt), author: cleanAuthor(r.author),
          comments: (Array.isArray(r.comments) ? r.comments : []).filter((c) => c && typeof c === "object" && str(c.text, 400)).map((c) => ({
            id: str(c.id, 60) || newId(), text: str(c.text, 400), createdAt: num(c.createdAt), author: cleanAuthor(c.author),
            owner: c.owner === true, likes: ids(c.likes), dislikes: ids(c.dislikes),
          })),
        });
      }
    }
    if (raw.owners && typeof raw.owners === "object") {
      for (const [k, o] of Object.entries(raw.owners)) {
        if (!o || typeof o !== "object" || !o.owner || !str(o.owner.id, 60) || !str(o.name, 60).trim()) continue;
        out.owners[str(k, 80)] = { name: str(o.name, 60).trim(), registeredAt: num(o.registeredAt), owner: cleanAuthor(o.owner) };
      }
    }
    return out;
  }

  function newId() {
    return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  let data = read();

  // 브라우저에 쓴다. 실패하면 오류를 돌려준다.
  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); return null; } catch (e) { return e; }
  }

  // 바꾸고 저장한다. 저장에 실패하면 바꾸기 전으로 되돌리고 까닭을 알려 준다.
  function commit(change) {
    const before = JSON.stringify(data);
    const value = change();
    const err = write();
    if (!err) return { ok: true, value };
    data = JSON.parse(before);
    const full = err.name === "QuotaExceededError" || err.code === 22 || err.code === 1014;
    return { ok: false, message: full
      ? "이 기기의 저장 공간이 가득 찼어요. 사진을 빼고 다시 남겨 보세요."
      : "이 브라우저에서는 저장할 수 없어요. (시크릿 창이거나 저장이 막혀 있을 수 있어요)" };
  }

  return {
    // 가게 이름이 같은 가게인지 가르는 기준: 앞뒤 빈칸을 없애고, 띄어쓰기를 하나로, 영어는 소문자로
    shopKey: keyOf,

    reload() { data = read(); },

    // 로그인한 상태인지. 로그인을 붙일 때 이 두 함수(getSession · logout)와 login 을 이 파일 안에서 이어 준다.
    getSession() {
      try {
        const s = JSON.parse(localStorage.getItem(SESSION_KEY));
        return s && typeof s === "object" ? s : null;
      } catch (e) { return null; }
    },
    // 로그아웃: 로그인한 상태만 지운다. 남긴 리뷰 · 프로필은 그대로 둔다.
    logout() {
      try { localStorage.removeItem(SESSION_KEY); return { ok: true }; }
      catch (e) { return { ok: false, message: "로그아웃하지 못했어요. 다시 눌러 주세요." }; }
    },
    getProfile: () => data.profile,
    getReviews: () => data.reviews,
    getOwners: () => data.owners,

    // 프로필 저장. 이름 · 그림을 바꾸면 내가 전에 쓴 리뷰와 댓글의 이름 · 그림도 같이 바뀐다.
    saveProfile({ name, emoji, color }) {
      return commit(() => {
        const id = data.profile ? data.profile.id : newId();
        const me = cleanAuthor({ id, name, emoji, color });
        data.profile = me;
        for (const r of data.reviews) {
          if (r.author.id === id) r.author = { ...me };
          for (const c of r.comments) if (c.author.id === id) c.author = { ...me };
        }
        for (const o of Object.values(data.owners)) if (o.owner.id === id) o.owner = { ...me };
        return me;
      });
    },

    // 가게 주인 등록: 한 가게에는 주인이 한 명. 리뷰가 아직 없는 가게도 등록할 수 있다.
    // (지금은 진짜 주인인지 확인할 방법이 없어서 이 기기에서는 누구나 등록할 수 있다. 확인은 로그인을 붙인 뒤에)
    registerShop(name) {
      if (!data.profile) return { ok: false, message: "먼저 내 프로필을 만들어 주세요." };
      const shop = str(name, 30).trim().replace(/\s+/g, " ");
      if (!shop) return { ok: false, message: "가게 이름을 적어 주세요." };
      const key = keyOf(shop), have = data.owners[key];
      if (have) return { ok: false, message: have.owner.id === data.profile.id ? "이미 내 가게로 등록돼 있어요." : "이미 주인이 등록된 가게예요." };
      return commit(() => {
        const same = data.reviews.filter((r) => keyOf(r.shop) === key);   // 새 리뷰가 앞이라 마지막이 처음 적은 이름
        data.owners[key] = { name: same.length ? same[same.length - 1].shop : shop, registeredAt: Date.now(), owner: { ...data.profile } };
        return key;
      });
    },

    // 댓글 좋아요/싫어요: 한 댓글에 한 사람이 한 번. 같은 걸 또 누르면 취소, 다른 걸 누르면 바뀐다. 내 댓글에는 못 누른다.
    react(reviewId, commentId, kind) {
      if (!data.profile) return { ok: false, message: "먼저 내 프로필을 만들어 주세요." };
      if (kind !== "like" && kind !== "dislike") return { ok: false, message: "알 수 없는 단추예요." };
      const review = data.reviews.find((r) => r.id === reviewId);
      const c = review && review.comments.find((x) => x.id === commentId);
      if (!c) return { ok: false, message: "그 댓글을 찾지 못했어요." };
      if (c.author.id === data.profile.id) return { ok: false, message: "내 댓글에는 누를 수 없어요." };
      return commit(() => {
        const me = data.profile.id, mine = kind === "like" ? c.likes : c.dislikes, other = kind === "like" ? c.dislikes : c.likes;
        const i = mine.indexOf(me);
        if (i >= 0) mine.splice(i, 1);
        else { mine.push(me); const j = other.indexOf(me); if (j >= 0) other.splice(j, 1); }
        return { likes: c.likes.length, dislikes: c.dislikes.length };
      });
    },

    // 리뷰 남기기 (작성자는 지금 프로필)
    addReview({ shop, menu, stars, text, photo }) {
      if (!data.profile) return { ok: false, message: "먼저 내 프로필을 만들어 주세요." };
      return commit(() => {
        const review = {
          id: newId(), shop: str(shop, 60).trim(), menu: str(menu, 60).trim(), stars: Math.min(5, Math.max(1, Math.round(stars))),
          text: str(text, 1000), photo: photo || null, createdAt: Date.now(), author: { ...data.profile }, comments: [],
        };
        data.reviews.unshift(review);
        return review;
      });
    },

    // 내가 쓴 리뷰 고치기 (댓글 · 쓴 날짜는 그대로, 고친 때만 남긴다)
    updateReview(id, { shop, menu, stars, text, photo }) {
      if (!data.profile) return { ok: false, message: "먼저 내 프로필을 만들어 주세요." };
      const r = data.reviews.find((x) => x.id === id);
      if (!r) return { ok: false, message: "그 리뷰를 찾지 못했어요." };
      if (r.author.id !== data.profile.id) return { ok: false, message: "내가 쓴 리뷰만 고칠 수 있어요." };
      return commit(() => {
        r.shop = str(shop, 60).trim() || r.shop; r.menu = str(menu, 60).trim() || r.menu;
        r.stars = Math.min(5, Math.max(1, Math.round(stars))); r.text = str(text, 1000);
        r.photo = photo || null; r.editedAt = Date.now();
        return r;
      });
    },

    // 내가 쓴 리뷰 지우기 (그 리뷰에 달린 댓글도 같이 지워진다)
    deleteReview(id) {
      if (!data.profile) return { ok: false, message: "먼저 내 프로필을 만들어 주세요." };
      const i = data.reviews.findIndex((x) => x.id === id);
      if (i < 0) return { ok: false, message: "그 리뷰를 찾지 못했어요." };
      if (data.reviews[i].author.id !== data.profile.id) return { ok: false, message: "내가 쓴 리뷰만 지울 수 있어요." };
      return commit(() => { data.reviews.splice(i, 1); });
    },

    // 댓글 달기 (작성자는 지금 프로필)
    addComment(reviewId, text) {
      if (!data.profile) return { ok: false, message: "먼저 내 프로필을 만들어 주세요." };
      const review = data.reviews.find((r) => r.id === reviewId);
      if (!review) return { ok: false, message: "그 리뷰를 찾지 못했어요." };
      return commit(() => {
        const o = data.owners[keyOf(review.shop)];       // 이 가게 주인이 단 댓글이면 사장님 답글로 표시
        const c = { id: newId(), text: str(text, 400), createdAt: Date.now(), author: { ...data.profile },
          owner: !!o && o.owner.id === data.profile.id, likes: [], dislikes: [] };
        review.comments.push(c);
        return c;
      });
    },
  };
})();
