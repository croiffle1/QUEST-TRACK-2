// 저장하는 코드는 전부 이 파일에만 있다. (index.html 은 localStorage 를 직접 쓰지 않는다)
// 지금은 이 기기의 브라우저(localStorage)에 저장한다.
// 나중에 로그인과 보관함(데이터베이스)을 붙일 때는 이 파일 안쪽만 바꾸면 된다.
//
// 저장하는 모양 ("pt-matjip-v1" 한 칸에 통째로):
//   { profile: { id, name, emoji, color } | null,
//     reviews: [ { id, shop, menu, stars(1~5), text, photo(data:image/… 또는 null), createdAt,
//                  author: { id, name, emoji, color },
//                  comments: [ { id, text, createdAt, author: { id, name, emoji, color } } ] } ]  // 새 리뷰가 맨 앞
//   }
// 가게는 따로 저장하지 않는다. 리뷰에 적힌 가게 이름이 같으면 같은 가게로 묶는다. (shopKey)

const Store = (() => {
  const KEY = "pt-matjip-v1";
  const SESSION_KEY = "pt-matjip-session";   // 로그인한 상태 (로그인은 아직 없어서 지금은 아무도 이 칸을 채우지 않는다)

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
    const out = { profile: null, reviews: [] };
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
          createdAt: num(r.createdAt), author: cleanAuthor(r.author),
          comments: (Array.isArray(r.comments) ? r.comments : []).filter((c) => c && typeof c === "object" && str(c.text, 400)).map((c) => ({
            id: str(c.id, 60) || newId(), text: str(c.text, 400), createdAt: num(c.createdAt), author: cleanAuthor(c.author),
          })),
        });
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
    shopKey: (name) => String(name).trim().replace(/\s+/g, " ").toLowerCase(),

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
        return me;
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

    // 댓글 달기 (작성자는 지금 프로필)
    addComment(reviewId, text) {
      if (!data.profile) return { ok: false, message: "먼저 내 프로필을 만들어 주세요." };
      const review = data.reviews.find((r) => r.id === reviewId);
      if (!review) return { ok: false, message: "그 리뷰를 찾지 못했어요." };
      return commit(() => {
        const c = { id: newId(), text: str(text, 400), createdAt: Date.now(), author: { ...data.profile } };
        review.comments.push(c);
        return c;
      });
    },
  };
})();
