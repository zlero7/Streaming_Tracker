# 방송 체크

등록해 둔 스트리머가 지금 방송 중인지 확인하고, **썸네일 / 제목 / 스트리머명 / 시청자 수**를 목록으로 보여주는 프로그램입니다.
지원 플랫폼은 치지직(CHZZK)과 SOOP이고, **웹 · Windows exe · Android 앱**으로 쓸 수 있어요.

## 구조

```
public/core.js       공용 코어: 치지직/SOOP 조회 + 등록 목록 관리 (서버와 앱이 같이 씀)
public/backend.js    화면이 쓰는 데이터 창구 (웹/exe는 서버 API, 모바일 앱은 앱 안에서 직접)
public/app.js|style.css|index.html   화면
server.js            로컬 서버 (웹/exe용)
electron/main.js     Windows exe (Electron이 server.js를 내부에서 실행)
android/             Android 앱 (Capacitor)
mobile/runner.js     Android 백그라운드 러너 (방송 시작 알림)
capacitor.config.json / scripts/    모바일 앱 설정, 웹 파일 복사 스크립트
.github/workflows/build.yml         exe / APK 자동 빌드
```

## 1. 웹으로 실행 (Node.js 18+)

```bash
node server.js     # 또는 npm start
```

http://localhost:3000 을 엽니다. 등록 목록은 `data/streamers.json`에 저장돼요.
`PORT`, `HOST` 환경 변수로 포트/접속 허용 주소를 바꿀 수 있어요 (`HOST=0.0.0.0`은 인증이 없으니 신뢰하는 네트워크에서만).

## 2. Windows exe

- 설치 없이 실행되는 **portable exe**예요. 더블클릭하면 창이 열려요.
- 코드 서명이 없어서 처음 실행할 때 Windows SmartScreen 경고가 뜰 수 있어요. **추가 정보 → 실행**을 누르면 돼요.
- 등록 목록은 `%APPDATA%\StreamerTracker\data`에 저장돼요.

직접 빌드하려면:

```bash
npm install
npm run build:win      # dist/ 에 exe 생성 (Windows에서 빌드하면 아이콘까지 정상 적용)
npm run electron       # 빌드 없이 바로 실행해보기
```

## 3. Android 앱

앱은 서버 없이 폰 안에서 직접 치지직/SOOP에 요청하고, 등록 목록은 폰에 저장해요.

**방법 A – Android Studio**

```bash
npm install
npm run mobile:sync    # public → www 복사 후 android/ 에 반영
npm run mobile:open    # Android Studio 열기 → Build > Build APK(s)
```

**방법 B – GitHub Actions (내 PC에 설치 불필요)**

레포에 올린 뒤 Actions 탭 → `앱 빌드` → Run workflow (또는 `v1.0.0` 같은 태그 푸시).
끝나면 실행 결과의 Artifacts에서 `android-apk`(APK)와 `windows-exe`를 받을 수 있어요.

### 방송 시작 알림 (Android 앱)

앱을 처음 열면 상단에 알림 안내가 떠요. **알림 허용**을 누르면, 앱을 닫아도 Android가 약 15분마다 백그라운드에서 등록한 스트리머를 확인하고 방송이 시작된 순간 알림을 보내요.

- 15분은 Android가 허용하는 최소 간격이에요. 배터리 상태에 따라 더 늦어질 수 있어요.
- 알림이 잘 안 오면 폰 설정에서 이 앱의 배터리 사용을 **제한 없음**으로 바꿔주세요. 삼성·샤오미 등 일부 제조사는 백그라운드 앱을 추가로 종료해서 [dontkillmyapp.com](https://dontkillmyapp.com) 안내가 필요할 수 있어요.
- 오프라인이던 스트리머가 방송 중으로 바뀐 순간에만 알려요. 이미 화면에서 본 방송, 방송이 잠깐 끊겼다 이어진 경우(30분 이내)에는 다시 알리지 않아요.
- 동작 원리: 화면이 등록 목록을 러너(`mobile/runner.js`)에 넘겨두고, 러너가 주기적으로 조회해서 상태가 바뀌면 알림을 보내요. 웹/exe에서는 이 기능이 없어요.

APK는 디버그 서명이라 폰에서 "출처를 알 수 없는 앱 설치"를 허용해야 설치돼요. Play 스토어 배포용 서명 빌드는 따로 설정이 필요해요.

## 참고

- 치지직·SOOP 모두 공식 공개 API가 아니라 웹사이트가 쓰는 API를 사용해요. 응답 형식이 바뀌면 `public/core.js`의 `chzzk` / `soop` 부분만 고치면 웹·exe·앱에 모두 반영돼요.
- 같은 스트리머는 15초 동안 캐시해서 상대 서버에 요청이 몰리지 않게 했어요.
- SOOP은 스테이션 API를 우선 쓰고, 실패하면 플레이어 API로 대체해요(이 경우 시청자 수는 `-`).
- iOS 앱은 Mac이 있어야 빌드할 수 있어서 포함하지 않았어요.
- 러너(`mobile/runner.js`)는 앱 화면과 별개의 환경에서 돌아서 `core.js`를 못 써요. 그래서 조회 주소가 `core.js`와 러너에 각각 있으니, API가 바뀌면 둘 다 고쳐야 해요.
