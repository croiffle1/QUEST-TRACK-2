# week-06 · 바깥 정보를 받아 오는 내 앱

## 주제
- 바깥 정보를 받아 오는 내 앱

## 이번 주 목표
- API 로 오늘 정보를 받아 와 보여 주고, 폰에 설치되는 앱으로 만들기

## 만들 것
- 우리 동네 날씨: week-06/index.html (평택시 지금 날씨, 오늘 가장 높은 · 낮은 기온)
  - 날씨는 wttr.in 에서 키 없이 받아 온다. (Open-Meteo 날씨 서버는 이 컴퓨터의 인터넷에서 연결이 안 돼서 바꿈. 위도 · 경도는 Open-Meteo 지명 검색으로 찾음)

  - 폰에 설치되는 앱(PWA): manifest.webmanifest, sw.js(서비스 워커), icons 폴더
  - 주소: https://croiffle1.github.io/QUEST-TRACK-2/week-06/
  - 앱 파일을 바꾸면 sw.js 의 VERSION 숫자를 하나 올려야 설치된 폰에도 새 파일이 들어간다.
  - 아이콘은 `node week-06/icons/make-icons.mjs` 로 다시 만든다.

## 확인 도구
- 쓰는 법: QUEST-TRACK-2 폴더에서 `node week-06/check/check.mjs`
- 진짜 날씨, 불러오는 중, 못 받아 왔을 때의 까닭, 다시 불러오기, 날씨 번호 → 한국어, 화면 폭(320~1920)을 확인한다.
- 마지막으로 받은 날씨를 받은 때와 같이 보여 주는지, 설치 앱(manifest · 아이콘 · 서비스 워커 · 인터넷 끊김)도 확인한다. 설치 앱은 GitHub Pages 와 같은 주소(/QUEST-TRACK-2/week-06/)로 작은 서버를 잠깐 켜서 확인한다.

## 이번 주 규칙
- API 키나 비밀번호는 파일에 적지 않는다.
- 정보를 못 받아 오면 빈 화면 대신 까닭을 보여 준다.
- 답은 한국어로 한다.
