// 서비스 워커: 앱 화면(파일)을 폰에 저장해 두고, 인터넷이 끊겨도 앱이 열리게 한다.
// 날씨 정보는 여기서 저장하지 않고, 앱(index.html)이 마지막으로 받은 것을 따로 기억한다.
// 앱 파일을 바꾸면 아래 VERSION 숫자를 하나 올려야 폰에 새 파일이 들어간다.

const VERSION = "weather-v1";
const FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
];

// 설치: 앱 파일을 모두 저장
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

// 켜짐: 예전 버전 저장소 지우기
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// 요청: 우리 앱 파일은 "먼저 인터넷, 안 되면 저장해 둔 것". 날씨 서버(wttr.in) 요청은 건드리지 않음
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) =>
          hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())
        )
      )
  );
});
