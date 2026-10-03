# Fishcon · 보이스 스튜디오

한국어 UI의 정적 웹앱입니다. 모든 요청과 음성 처리는 사용자의 브라우저에서 실행됩니다. 애플리케이션 백엔드, API 프록시, 데이터베이스, 서비스 워커가 없습니다.

## GitHub Pages 배포

[웹사이트 열기](https://sandboxwork.github.io/fishcon-voice-studio/) · [GitHub 저장소](https://github.com/sandboxwork/fishcon-voice-studio) · [배포 상태](https://github.com/sandboxwork/fishcon-voice-studio/actions/workflows/pages.yml)

`main` 브랜치에 푸시하면 `.github/workflows/pages.yml`이 JavaScript 검사와 단위 테스트를 실행하고, Chrome 확장판을 다시 빌드한 뒤 `dist/`를 GitHub Pages에 배포합니다. GitHub 저장소의 **Settings → Pages → Source**는 **GitHub Actions**로 설정합니다. 수동 재배포는 **Actions → Build and deploy GitHub Pages → Run workflow**에서 실행합니다.

```bash
npm ci
npm run check
npm test
npm run build
```

HTML, CSS, JavaScript와 확장판 다운로드 링크는 모두 상대 경로를 사용하므로 `https://사용자.github.io/저장소/` 하위 경로에서도 동작합니다. Pages는 정적 파일만 제공하며 Fish Audio 요청을 중계하지 않습니다. GitHub PAT나 Fish Audio API 키를 저장소 또는 Actions secrets에 추가할 필요가 없습니다. 배포는 GitHub가 실행마다 발급하는 `GITHUB_TOKEN`과 OIDC를 사용합니다.

## 실행

Node.js 20 이상으로 실행합니다. 일반 실행에는 패키지 설치가 필요 없습니다.

```bash
npm run dev
```

`http://localhost:5173`을 엽니다. 개발용 서버는 `dist/` 파일만 제공하며 API 요청을 중계하지 않습니다. HTTPS 정적 호스팅에는 `dist/` 폴더를 그대로 배포할 수 있습니다. ES 모듈과 클립보드 권한 때문에 `file://`로 직접 여는 방식은 지원하지 않습니다.

## 현재 API 연결 제한과 Chrome 확장판

2026-10-03 실제 확인 결과, `https://api.fish.audio/v1/tts`는 다음 CORS 사전 요청에 `404`, `no route serves this path`를 반환했고 `Access-Control-Allow-Origin` 헤더가 없었습니다. 일반 웹에서 Authorization 및 JSON 헤더를 보내면 이 사전 요청이 필수이므로, 해당 정책이 유지되는 동안 정적 웹사이트에서 직접 생성할 수 없습니다. 프론트엔드 코드로 공급자의 CORS 정책을 변경할 수 없습니다.

```bash
curl -i -X OPTIONS https://api.fish.audio/v1/tts \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type,model'
```

이 제약에 대응해 같은 프론트엔드를 Manifest V3 Chrome 확장판으로 제공합니다. 확장의 **자체 탭**에서 `host_permissions`로 Fish Audio에 직접 요청합니다. 콘텐츠 스크립트, 중계 서버, 별도 네이티브 앱은 사용하지 않습니다. 호스트 권한은 `https://api.fish.audio/*`, 추가 권한은 `clipboardWrite`뿐입니다. [Chrome 공식 문서](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)

1. `dist/fishcon-extension.zip`을 압축 해제합니다. 웹 화면의 **설치 안내**에서도 다운로드할 수 있습니다.
2. 데스크톱 Chrome에서 `chrome://extensions`를 엽니다.
3. **개발자 모드 → 압축해제된 확장 프로그램을 로드합니다**에서 압축 해제한 폴더를 선택합니다.
4. Fishcon 확장 아이콘을 누르고 **스튜디오 열기**로 새 탭을 엽니다. 이 탭을 열어둔 상태에서 작업하세요.
5. API 키와 대본을 입력하고 **음성 생성하기**를 누릅니다.

소스 수정 후 확장판을 다시 만들려면 Python 3으로 `npm run build`를 실행하고 확장 관리 화면에서 새로고침합니다. 이는 브라우저 자체 보안 기능을 끄는 방식이 아닙니다. 일반 웹의 직접 요청도 그대로 구현되어 있어 Fish Audio가 CORS를 허용하면 확장판 없이 사용할 수 있습니다.

## 기능과 데이터 처리

- API 키·모델·보이스 ID·속도·파일 형식·대본을 입력 즉시 `localStorage`의 `fishcon:studio:v1` 항목에 저장하고 다시 열 때 복원합니다. API 키도 이 기기의 브라우저에 평문으로 저장되며, 화면에서는 기본적으로 가립니다. 키는 Fish Audio에만 전송하고 URL이나 로그에는 기록하지 않습니다.
- **저장된 설정 삭제**는 이 앱의 API 키·설정·대본만 삭제하고 입력을 기본값으로 되돌립니다. 다른 사이트 데이터는 삭제하지 않습니다. 저장 공간 부족이나 접근 제한이 있으면 안내를 표시하고 현재 탭에서는 계속 사용할 수 있습니다.
- 웹사이트와 Chrome 확장판은 서로 다른 출처이므로 저장 공간을 공유하지 않습니다. 브라우저의 사이트 데이터를 지우면 저장된 설정도 삭제됩니다.
- `POST https://api.fish.audio/v1/tts`에 `Authorization: Bearer …`, `Content-Type: application/json`, `model` 헤더를 보냅니다. 외부 리디렉션을 따라가지 않습니다.
- S2.1 Pro / S2.1 Pro Free / S2 Pro / S1, 선택적 `reference_id`, 0.5~2.0배 말하기 속도를 지원합니다.
- WAV(16-bit PCM) 또는 MP3(192 kbps), 44.1 kHz 모노 출력을 요청합니다. 기본값은 S2.1 Pro와 WAV입니다.
- 생성 중 수신 크기와 경과 시간, 취소, 3분 제한 시간, 인증·잔액·사용량·네트워크 오류를 처리합니다. 자동 재시도는 하지 않습니다. 취소되더라도 공급자에서 이미 처리한 요청은 과금될 수 있습니다.
- 실제 음성 샘플을 사용한 파형, 브라우저 재생, 원본 파일 다운로드, 실제 음성 데이터 복사, Final Cut용 48 kHz WAV 변환을 제공합니다.
- 앱 자체 한도는 대본 10,000자, 수신 음성 80 MB입니다. Fish Audio의 별도 계정/모델 한도가 적용될 수 있습니다.
- 성공한 최신 음성 한 개만 메모리에 보관합니다. 다음 생성이 실패하거나 취소되면 이전 결과를 유지합니다. 탭을 닫기 전에 다운로드하세요.
- 선택적 WebMCP `stage_speech_text` 도구는 대본 입력만 수행합니다. API 키 접근이나 과금되는 음성 생성은 수행하지 않습니다.

## 클립보드와 Final Cut Pro

**순수 브라우저에서 음성을 복사한 뒤 Final Cut 타임라인에 ⌘V로 붙여넣는 기능은 제공하지 않습니다.** Final Cut은 네이티브 전용 pasteboard 형식과 실제 미디어 파일을 필요로 합니다. 브라우저 전용 클립보드 MIME, Base64 문자열, Blob URL, FCPXML 문자열을 쓰는 것만으로 이 기능을 구현할 수 없습니다.

**음성 데이터 복사**는 브라우저의 실제 지원 여부를 검사합니다.

| 지원 상태 | 실제 복사 내용 | 붙여넣기 범위 |
| --- | --- | --- |
| 표준 오디오 MIME 지원 | WAV/MP3 바이너리 | 대상 앱의 해당 형식 지원 필요 |
| Web custom format 지원 | `web audio/wav` 또는 `web audio/mpeg` 바이너리 | 같은 웹 형식을 읽을 수 있는 앱 |
| 텍스트만 지원 | 음성 전체를 담은 Base64 데이터 URL | 텍스트 또는 데이터 URL을 처리하는 앱 |
| 클립보드 접근 불가 | 복사하지 않고 안내 | 다운로드 사용 |

어떤 경우에도 성공한 척하는 가짜 Final Cut 복사를 표시하지 않습니다. Safari 등에서는 텍스트 대체 방식으로 실제 음성 데이터를 복사하며, UI가 그 사실을 명시합니다. 클립보드 쓰기는 버튼 클릭 시에만 수행하며 기존 클립보드 내용을 읽지 않습니다.

Final Cut에서는 **Final Cut용 WAV 저장**을 눌러 48 kHz / 16-bit PCM WAV를 저장하고, Finder에서 파일을 타임라인으로 드래그하거나 `파일 → 가져오기 → 미디어`에서 선택하세요. MP3로 생성해도 브라우저에서 WAV로 변환합니다. 원본이 이미 압축된 MP3라면 WAV로 바꾸어도 손실된 정보가 복원되지는 않습니다. 직접 붙여넣기는 macOS 네이티브 연동과 실제 Final Cut에서의 추가 검증이 필요한 별도 작업입니다.

## 검증

```bash
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

Linux에 Chromium 시스템 라이브러리가 없으면 `npx playwright install-deps chromium`으로 설치합니다. 실행 환경에 따라 관리자 권한이 필요합니다.

단위 테스트는 요청 형식, WAV 헤더·PCM 인터리빙·클리핑, 분할 응답 수신, 오류/빈 파일/손상 응답, 80 MB 초과 중단을 검증합니다. 브라우저 테스트는 **모의 API의 실제 WAV 바이트**로 재생·다운로드·48 kHz 변환, 클립보드 바이너리/텍스트 대체 및 권한 거부, 취소 후 재시도, CORS/401 오류, 설정 복원·삭제·저장 실패 처리, 모바일 레이아웃, 대본 입력 도구를 검증합니다.

실제 Chromium에 확장판을 로드하고 확장 탭에서 인증키 없는 Fish Audio POST 요청을 수행해, CORS 오류 없이 HTTP 401 인증 응답을 읽는 것을 확인했습니다. 유효한 사용자 API 키가 제공되지 않아 Fish Audio의 실제 음성 합성 품질/계정별 과금과 macOS Final Cut에서의 파일 가져오기는 이 환경에서 검증하지 않았습니다. WebMCP 등록과 입력은 모의 컨텍스트로 검증하며, 호스트의 실제 WebMCP 지원은 별도입니다.

## 근거 문서

- [Fish Audio 기능 개요](https://docs.fish.audio/overview/capabilities)
- [Text to Speech 사용법](https://docs.fish.audio/features/text-to-speech)
- [TTS API 레퍼런스](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech)
- [Chrome 확장의 교차 출처 요청](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Chrome 웹 사용자 정의 클립보드 형식](https://developer.chrome.com/blog/web-custom-formats-for-the-async-clipboard-api/)
- [WebKit 클립보드 API](https://webkit.org/blog/10855/async-clipboard-api/)
- [Final Cut 전용 pasteboard 조사](https://github.com/Hammerspoon/hammerspoon/issues/1016)
- [Apple: Mac에서 미디어 가져오기](https://support.apple.com/en-au/guide/final-cut-pro/ver418155a4/mac)

`dist/`는 배포 가능한 프론트엔드 소스입니다. 정적 호스팅에 필요한 파일을 직접 관리하므로 소스 저장소에서도 추적합니다. `extension/`은 `npm run build`로 생성되는 배포 사본입니다.
