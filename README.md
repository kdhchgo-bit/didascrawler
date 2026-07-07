# DIDAS Crawler

도화 DIDAS/플랫폼에서 문서를 검색하고, 검색 결과 파일을 내려받고, 로컬 작업 파일을 프로젝트별로 자동 업로드하기 위한 Node.js 기반 자동화 도구입니다.

Playwright로 사내 DIDAS 웹 화면에 로그인한 뒤 검색 결과와 네트워크 응답을 수집합니다. CLI로 실행할 수도 있고, 로컬 웹 GUI 또는 Electron 데스크톱 앱으로 사용할 수도 있습니다.

## 주요 기능

- DIDAS/도화 플랫폼 로그인 자동화
- 검색어, 발주처, 담당부서, 참여자 조건 기반 문서 검색
- 검색 결과를 JSON/CSV로 저장
- 검색 결과 파일 다운로드
- 검색 결과를 내 캐비닛으로 복사
- 오늘 작업한 로컬 파일을 스캔해 프로젝트/공정/카테고리 후보를 추천
- 자동 업로드 계획 생성 및 실제 업로드 실행
- 로컬 웹 GUI와 Electron 데스크톱 실행 지원

## 요구 사항

- Node.js 20 이상 권장
- npm
- Windows + Chrome 설치 환경
- DIDAS/도화 플랫폼에 접근 가능한 네트워크와 계정

기본 Chrome 경로는 다음 값으로 설정되어 있습니다.

```text
C:\Program Files\Google\Chrome\Application\chrome.exe
```

다른 경로를 쓰는 경우 `config.json`의 `browser.executablePath`를 수정하세요.

## 설치

```bash
npm install
```

## 설정

이 저장소의 `config.json`과 `config.example.json`은 계정 정보가 비어 있는 상태로 커밋됩니다.

실행 전 `config.json`에 실제 값을 입력하세요.

```json
{
  "credentials": {
    "id": "",
    "password": ""
  },
  "search": {
    "query": "기술심의신청서",
    "maxPages": 5,
    "filters": {
      "orderOfficeName": "",
      "departmentName": "",
      "participant": ""
    }
  },
  "browser": {
    "headless": true,
    "executablePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  },
  "outputDir": "outputs",
  "download": {
    "enabled": true,
    "limit": 12,
    "copyToCabinet": false
  },
  "autoUpload": {
    "workDir": "",
    "since": "today",
    "limit": 50,
    "projectHint": "",
    "processHint": "",
    "categoryHint": "",
    "dryRun": true
  }
}
```

### 주요 설정값

| 키 | 설명 |
| --- | --- |
| `credentials.id` | DIDAS/플랫폼 로그인 ID |
| `credentials.password` | DIDAS/플랫폼 로그인 비밀번호 |
| `search.query` | 기본 검색어 |
| `search.maxPages` | 검색 결과를 가져올 최대 페이지 수 |
| `search.filters.orderOfficeName` | 발주처 필터 |
| `search.filters.departmentName` | 담당부서 필터 |
| `search.filters.participant` | 참여자 필터 |
| `browser.headless` | 브라우저를 숨김 모드로 실행할지 여부 |
| `browser.executablePath` | 사용할 Chrome 실행 파일 경로 |
| `outputDir` | 결과 파일 저장 폴더 |
| `download.enabled` | 검색 결과 파일 다운로드 여부 |
| `download.limit` | 다운로드할 최대 파일 수 |
| `download.dir` | 다운로드 파일 저장 폴더. 없으면 `outputs/downloads` 사용 |
| `download.copyToCabinet` | 검색 결과를 내 캐비닛으로 복사할지 여부 |
| `sessionDir` | CLI 실행 시 브라우저 세션을 저장할 폴더. 없으면 `session` 사용 |
| `autoUpload.workDir` | 자동 업로드 후보 파일을 찾을 로컬 작업 폴더 |
| `autoUpload.since` | 파일 수정 시간 기준. `today`, 시간 숫자, 날짜 문자열 사용 가능 |
| `autoUpload.limit` | 자동 업로드 후보 최대 개수 |
| `autoUpload.projectHint` | 프로젝트 매칭에 추가로 사용할 힌트 |
| `autoUpload.processHint` | 공정/업무 분류 힌트 |
| `autoUpload.categoryHint` | 업로드 카테고리 힌트 |
| `autoUpload.dryRun` | 실제 업로드 없이 계획만 만들지 여부 |

### 환경 변수

| 이름 | 설명 |
| --- | --- |
| `DOHWA_DATA_ROOT` | 설정, 세션, 결과 파일을 저장할 런타임 루트 폴더 |
| `PORT` | 로컬 GUI 서버 포트. 기본값은 `3000` |

## CLI 사용법

### 검색 실행

```bash
npm run search
```

`npm run search`는 `config.json` 설정을 그대로 사용합니다. `download.enabled`가 `true`이면 검색 후 다운로드도 수행합니다. 검색 결과만 수집하려면 `config.json`에서 `download.enabled`를 `false`로 두거나 CLI에서 다운로드 옵션을 넘기지 않는 별도 설정 파일을 사용하세요.

직접 옵션을 넘길 수도 있습니다.

```bash
node crawler.js --query "기술심의신청서" --max-pages 5 --headed
```

자주 쓰는 추가 옵션:

| 옵션 | 설명 |
| --- | --- |
| `--config <path>` | 사용할 설정 파일 경로 |
| `--probe` | 로그인/검색 화면 탐색 위주로 실행하고 페이지 순회는 건너뜀 |
| `--download-dir <path>` | 다운로드 저장 폴더 지정 |
| `--headless` | 브라우저 창 없이 실행 |
| `--headed` | 브라우저 창을 보면서 실행 |

### 검색 후 다운로드

```bash
npm run download
```

또는:

```bash
node crawler.js --query "자료" --download --download-limit 12
```

### 검색 결과를 내 캐비닛으로 복사

```bash
npm run cabinet-download
```

### 필터 검색

```bash
node crawler.js --query "자료" --order-office "발주처명" --department "부서명" --participant "참여자명"
```

### 자동 업로드 계획 생성

기본값은 dry-run입니다. 실제 업로드 없이 어떤 파일이 어느 프로젝트/카테고리에 매칭되는지 계획 파일만 만듭니다.

```bash
node auto-upload.js --work-dir "D:\Projects\today" --since today --limit 50 --dry-run
```

### 실제 자동 업로드

```bash
node auto-upload.js --work-dir "D:\Projects\today" --since today --limit 50 --upload
```

자동 업로드는 파일명과 폴더명, 프로젝트명, 프로젝트 코드, 힌트 값을 이용해 대상 프로젝트와 카테고리를 추정합니다. 신뢰도가 낮거나 프로젝트를 찾지 못한 항목은 업로드하지 않고 보류 상태로 남깁니다.

## GUI 사용법

로컬 웹 GUI:

```bash
npm run server:open
```

브라우저를 직접 열지 않고 서버만 실행:

```bash
npm run server
```

기본 주소:

```text
http://127.0.0.1:3000
```

Electron 데스크톱 앱:

```bash
npm run desktop
```

GUI에서는 다음 작업을 할 수 있습니다.

- 로그인 정보와 Chrome 경로 저장
- 자동 업로드 계획 보기
- 실제 업로드 실행
- DIDAS 검색/다운로드 실행
- 실행 로그 확인
- 검색 결과 필터링
- 검색 결과 파일 개별 다운로드

Electron 실행 시 런타임 데이터는 기본적으로 Windows 문서 폴더의 `DohwaCrawler` 아래에 저장됩니다.

## 결과 파일

기본 결과 폴더는 `outputs/`입니다.

| 경로 | 설명 |
| --- | --- |
| `outputs/search-results.json` | 정규화된 검색 결과 |
| `outputs/search-results.csv` | 엑셀에서 열기 쉬운 검색 결과 CSV |
| `outputs/search-responses.json` | 검색 응답 중 결과 추출에 사용한 응답 목록 |
| `outputs/network-log.json` | DIDAS/플랫폼 관련 네트워크 응답 로그 |
| `outputs/responses/` | 개별 API/HTML 응답 저장 폴더 |
| `outputs/visited-pages.json` | 검색 결과 페이지 이동 기록 |
| `outputs/result-links.json` | 화면에서 추출한 결과 링크 후보 |
| `outputs/page.html` | 검색 결과 화면 HTML 스냅샷 |
| `outputs/page-text.txt` | 검색 결과 화면 텍스트 스냅샷 |
| `outputs/extracted.json` | HTML/API 응답에서 추출한 중간 결과 |
| `outputs/cabinet-copy.json` | 내 캐비닛 복사 결과 |
| `outputs/downloads/` | 다운로드 파일 저장 폴더 |
| `outputs/downloads/**/download-manifest.json` | 다운로드 성공/실패 내역 |
| `outputs/download-cache.json` | GUI 개별 다운로드 캐시 |
| `outputs/download-failures.json` | GUI 개별 다운로드 실패 캐시 |
| `outputs/auto-upload-projects.json` | 자동 업로드용 내 프로젝트 목록 캡처 |
| `outputs/auto-upload-plan.json` | dry-run 자동 업로드 계획 |
| `outputs/auto-upload-result.json` | 실제 자동 업로드 결과 |

## 테스트

```bash
npm test
```

현재 테스트는 자동 업로드 후보 파일 스캔, 프로젝트 매칭, 카테고리 매칭, 낮은 신뢰도 항목 보류 로직을 검증합니다.

## 빌드

Windows용 Electron 패키지 생성:

```bash
npm run build:win
```

빌드 결과는 `dist/`에 생성됩니다. `dist/`, `outputs/`, `session/`, `logs/`, `worker_scratch/`, zip/log 파일은 저장소에 커밋하지 않습니다.

## 보안 주의

- 실제 계정 정보가 들어간 `config.json`은 공개 저장소에 올리지 마세요.
- 브라우저 세션 정보가 들어 있는 `session/`은 커밋하지 마세요.
- 크롤링 결과와 네트워크 로그가 들어 있는 `outputs/`는 민감 정보를 포함할 수 있으므로 커밋하지 마세요.
- 이 도구는 DIDAS/도화 플랫폼 접근 권한이 있는 사용자의 업무 자동화를 위한 것입니다. 권한 없는 계정이나 허가되지 않은 환경에서 사용하지 마세요.

## 프로젝트 구조

```text
.
├─ crawler.js              # DIDAS 로그인, 검색, 결과 추출, 다운로드
├─ auto-upload.js          # 로컬 파일 스캔 후 자동 업로드 계획/실행
├─ auto-upload/            # 파일 스캔, 매칭, 포털 업로드 유틸리티
├─ gui-server.js           # 로컬 GUI 서버와 API
├─ gui/                    # 브라우저 GUI 정적 파일
├─ desktop-main.js         # Electron 앱 진입점
├─ scripts/clean-package.js
├─ test/                   # node:test 기반 테스트
├─ config.example.json     # 설정 예시
└─ package.json
```
