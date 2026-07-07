# DIDAS Crawler

DIDAS Crawler는 도화 DIDAS/플랫폼 업무에서 문서 검색, 결과 다운로드, 작업 파일 업로드를 한 흐름으로 묶어주는 로컬 자동화 도구입니다.

Playwright 기반 브라우저 자동화로 DIDAS에 로그인하고, 검색 조건에 맞는 문서 목록을 수집한 뒤 JSON/CSV 결과와 다운로드 파일을 정리합니다. 별도의 GUI와 Electron 데스크톱 실행도 지원해 CLI에 익숙하지 않은 사용자도 같은 워크플로우를 실행할 수 있습니다.

## 주요 기능

- DIDAS/플랫폼 로그인 자동화
- 검색어, 발주처, 담당부서, 참여자 기준 문서 검색
- 검색 결과 JSON/CSV 저장
- 검색 결과 파일 다운로드
- 검색 결과를 내 캐비닛으로 복사
- 로컬 작업 폴더에서 최근 파일 스캔
- 파일명/폴더명/프로젝트 정보를 바탕으로 업로드 대상 프로젝트와 카테고리 추천
- dry-run 기반 자동 업로드 계획 생성
- 실제 자동 업로드 실행
- 로컬 웹 GUI 및 Electron 데스크톱 앱 실행

## 동작 흐름

### 문서 검색과 다운로드

`crawler.js`가 DIDAS에 로그인한 뒤 검색 화면 또는 검색 API 응답에서 결과를 추출합니다. 결과는 `outputs/search-results.json`과 `outputs/search-results.csv`로 저장되며, 다운로드 옵션을 켜면 첨부 파일도 함께 저장합니다.

### 자동 업로드

`auto-upload.js`는 지정한 작업 폴더에서 최근 수정된 문서를 찾고, 파일명과 프로젝트 목록을 비교해 업로드 계획을 만듭니다. 기본은 dry-run이므로 실제 업로드 전에 대상 프로젝트, 카테고리, 신뢰도, 보류 항목을 먼저 확인할 수 있습니다.

### GUI와 데스크톱 앱

`gui-server.js`는 로컬 웹 GUI를 제공하고, `desktop-main.js`는 같은 GUI를 Electron 창으로 띄웁니다. GUI에서는 설정 저장, 검색 실행, 자동 업로드 계획 확인, 실제 업로드, 로그와 결과 확인을 한 화면에서 처리합니다.

## 설치

```bash
npm install
```

권장 실행 환경:

- Node.js 20 이상
- Windows
- Chrome 설치 환경
- DIDAS/플랫폼에 접근 가능한 네트워크와 계정

기본 Chrome 경로:

```text
C:\Program Files\Google\Chrome\Application\chrome.exe
```

Chrome 설치 경로가 다르면 `config.json`의 `browser.executablePath`를 바꾸면 됩니다.

## 설정

처음 실행할 때는 `config.example.json`을 복사해 `config.json`을 만들고, 로그인 정보와 검색 조건, 출력 경로처럼 환경에 맞는 값만 채워 사용합니다.

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

### 설정 항목

| 키 | 설명 |
| --- | --- |
| `credentials.id` | DIDAS/플랫폼 로그인 ID |
| `credentials.password` | DIDAS/플랫폼 로그인 비밀번호 |
| `search.query` | 기본 검색어 |
| `search.maxPages` | 가져올 검색 결과 최대 페이지 수 |
| `search.filters.orderOfficeName` | 발주처 필터 |
| `search.filters.departmentName` | 담당부서 필터 |
| `search.filters.participant` | 참여자 필터 |
| `browser.headless` | 브라우저 창 표시 여부 |
| `browser.executablePath` | Chrome 실행 파일 경로 |
| `outputDir` | 결과 저장 폴더 |
| `download.enabled` | 검색 후 다운로드 실행 여부 |
| `download.limit` | 최대 다운로드 파일 수 |
| `download.dir` | 다운로드 저장 폴더. 기본값은 `outputs/downloads` |
| `download.copyToCabinet` | 검색 결과를 내 캐비닛으로 복사할지 여부 |
| `sessionDir` | CLI 실행 시 브라우저 세션 저장 폴더. 기본값은 `session` |
| `autoUpload.workDir` | 자동 업로드 후보를 찾을 작업 폴더 |
| `autoUpload.since` | 후보 파일 수정 시간 기준. `today`, 시간 숫자, 날짜 문자열 사용 가능 |
| `autoUpload.limit` | 자동 업로드 후보 최대 개수 |
| `autoUpload.projectHint` | 프로젝트 매칭 힌트 |
| `autoUpload.processHint` | 공정/업무 분류 힌트 |
| `autoUpload.categoryHint` | 업로드 카테고리 힌트 |
| `autoUpload.dryRun` | 실제 업로드 없이 계획만 생성할지 여부 |

### 환경 변수

| 이름 | 설명 |
| --- | --- |
| `DOHWA_DATA_ROOT` | 설정, 세션, 결과 파일을 저장할 런타임 루트 |
| `PORT` | 로컬 GUI 서버 포트. 기본값은 `3000` |

## 사용법

### 검색 실행

```bash
npm run search
```

`npm run search`는 `config.json`의 검색/다운로드 설정을 그대로 사용합니다. `download.enabled`가 `true`이면 검색 후 다운로드도 이어서 수행합니다.

직접 옵션을 넘겨 실행할 수도 있습니다.

```bash
node crawler.js --query "기술심의신청서" --max-pages 5 --headed
```

자주 쓰는 옵션:

| 옵션 | 설명 |
| --- | --- |
| `--config <path>` | 사용할 설정 파일 경로 |
| `--probe` | 로그인/검색 화면 탐색 중심 실행 |
| `--download` | 검색 결과 파일 다운로드 |
| `--download-limit <n>` | 다운로드할 최대 파일 수 |
| `--download-dir <path>` | 다운로드 저장 폴더 |
| `--copy-to-cabinet` | 검색 결과를 내 캐비닛으로 복사 |
| `--headless` | 브라우저 창 없이 실행 |
| `--headed` | 브라우저 창을 보면서 실행 |

### 다운로드 중심 실행

```bash
npm run download
```

```bash
node crawler.js --query "자료" --download --download-limit 12
```

### 내 캐비닛 복사

```bash
npm run cabinet-download
```

### 필터 검색

```bash
node crawler.js --query "자료" --order-office "발주처명" --department "부서명" --participant "참여자명"
```

### 자동 업로드 계획 생성

```bash
node auto-upload.js --work-dir "D:\Projects\today" --since today --limit 50 --dry-run
```

### 실제 자동 업로드

```bash
node auto-upload.js --work-dir "D:\Projects\today" --since today --limit 50 --upload
```

자동 업로드는 먼저 프로젝트 목록을 가져온 뒤 파일별 대상 프로젝트와 카테고리를 추정합니다. 신뢰도가 낮은 항목은 업로드하지 않고 계획에서 보류 상태로 표시합니다.

## GUI 실행

로컬 웹 GUI:

```bash
npm run server:open
```

서버만 실행:

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

GUI에서 제공하는 작업:

- 로그인 정보와 Chrome 경로 저장
- 검색 조건과 다운로드 옵션 설정
- 자동 업로드 작업 폴더와 매칭 힌트 설정
- dry-run 계획 생성
- 실제 업로드 실행
- 실행 로그 확인
- 검색 결과와 다운로드 파일 확인

Electron 앱은 기본적으로 Windows 문서 폴더의 `DohwaCrawler` 아래에 런타임 데이터를 저장합니다.

## 생성되는 결과

기본 결과 폴더는 `outputs/`입니다.

### 핵심 산출물

| 경로 | 설명 |
| --- | --- |
| `outputs/search-results.json` | 정규화된 검색 결과 |
| `outputs/search-results.csv` | CSV 검색 결과 |
| `outputs/downloads/` | 다운로드 파일 저장 폴더 |
| `outputs/auto-upload-plan.json` | dry-run 자동 업로드 계획 |
| `outputs/auto-upload-result.json` | 실제 자동 업로드 결과 |
| `outputs/cabinet-copy.json` | 내 캐비닛 복사 결과 |

### 진단 및 캐시 산출물

| 경로 | 설명 |
| --- | --- |
| `outputs/search-responses.json` | 검색 결과 추출에 사용한 응답 목록 |
| `outputs/network-log.json` | DIDAS/플랫폼 관련 네트워크 응답 로그 |
| `outputs/responses/` | 개별 API/HTML 응답 저장 폴더 |
| `outputs/visited-pages.json` | 검색 결과 페이지 이동 기록 |
| `outputs/result-links.json` | 화면에서 추출한 결과 링크 후보 |
| `outputs/page.html` | 검색 결과 화면 HTML 스냅샷 |
| `outputs/page-text.txt` | 검색 결과 화면 텍스트 스냅샷 |
| `outputs/extracted.json` | HTML/API 응답에서 추출한 중간 결과 |
| `outputs/downloads/**/download-manifest.json` | 다운로드 성공/실패 내역 |
| `outputs/download-cache.json` | GUI 개별 다운로드 캐시 |
| `outputs/download-failures.json` | GUI 개별 다운로드 실패 캐시 |
| `outputs/auto-upload-projects.json` | 자동 업로드용 내 프로젝트 목록 |

## 저장소 구성

이 저장소는 소스 코드와 실행에 필요한 메타데이터 중심으로 구성합니다. 실행 중 생성되는 세션, 로그, 검색 결과, 다운로드 파일, 빌드 산출물은 로컬 런타임 데이터로 취급합니다.

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

GitHub에서 런타임 폴더 구조를 볼 수 있도록 `logs/`, `outputs/`, `session/`, `worker_scratch/`, `node_modules/`에는 안내용 README만 포함합니다. 실제 의존성은 `npm install`로 재현하고, 실제 실행 데이터는 로컬에서 생성합니다.

`dist/`와 zip 패키지는 빌드 산출물이므로 저장소에 포함하지 않습니다.

## 테스트

```bash
npm test
```

테스트는 자동 업로드 후보 파일 스캔, 프로젝트 매칭, 카테고리 매칭, 낮은 신뢰도 항목 보류 로직을 검증합니다.

## 빌드

Windows용 Electron 패키지 생성:

```bash
npm run build:win
```

빌드 결과는 `dist/`에 생성됩니다.
