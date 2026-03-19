# Finance Poller

Electron 기반의 Windows 트레이 백그라운드 앱입니다. `yahoo-finance2`로 Yahoo Finance 시세를 15초마다 polling하고, 여러 티커를 작은 위젯 형태로 띄워 가격과 일간 변동률을 모니터링합니다.

## 개요

- 15초 주기로 Yahoo Finance 시세 조회
- 시스템 트레이 상주
- 최대 12개 티커 위젯 관리
- 가격 / 일간 변동률 임계치 알림
- 창 위치와 위젯 설정을 로컬 파일에 저장
- 패키징된 앱은 로그인 시 숨김 상태로 자동 실행

## 주요 기능

### 시세 표시

- Yahoo Finance 응답을 받아 현재 표시 가격을 계산합니다.
- 장전(`PRE`, `PREPRE`)에는 `preMarketPrice`
- 장후(`POST`, `POSTPOST`)에는 `postMarketPrice`
- 그 외에는 `regularMarketPrice`
- 전일 종가 대비 절대값 / 퍼센트 변동도 함께 표시합니다.

### 알림 조건

각 위젯마다 아래 조건을 설정할 수 있습니다.

- `priceAbove`
- `priceBelow`
- `changePercentAbove`
- `changePercentBelow`

알림을 켜면 해당 위젯의 조건 입력창은 잠기고, 조건을 만족하는 동안 폴링 시점마다 데스크톱 알림을 보냅니다.

### 트레이 동작

- 창의 `_` 버튼은 앱 종료가 아니라 트레이로 숨기기입니다.
- 트레이 아이콘 클릭으로 창 표시/숨김을 토글합니다.
- 트레이 메뉴에는 `Open`, `Quit`가 있습니다.
- 패키징된 앱은 로그인 시 `--hidden` 인자로 실행되도록 설정됩니다.

## 기술 스택

- Electron 40
- yahoo-finance2 3.13.2
- electron-builder 26
- 순수 HTML / CSS / JavaScript 렌더러

## 실행 방법

### 요구 사항

- Node.js
- npm

### 개발 실행

```bash
npm install
npm start
```

### 코드 체크

문법 체크만 수행합니다.

```bash
npm run check
```

### Windows 패키징

설치 없이 실행 가능한 디렉터리 산출물:

```bash
npm run pack:win
```

NSIS 설치 파일 생성:

```bash
npm run dist:win
```

빌드 결과물은 `dist/` 아래에 생성됩니다. `build/after-pack.js`는 패키징 후 Windows 실행 파일 메타데이터와 아이콘을 보정합니다.

## 사용 방법

1. 앱 실행 후 `+` 버튼으로 티커를 추가합니다.
2. 예: `AAPL`, `MSFT`, `005930.KS`, `KRW=X`
3. 각 카드 오른쪽에서 임계치를 입력합니다.
4. 벨 버튼으로 알림을 활성화합니다.
5. 가격이 오르거나 내리면 카드가 잠깐 강조 표시됩니다.
6. `_` 버튼으로 창을 숨기면 앱은 트레이에서 계속 동작합니다.

## 상태 저장

앱 상태는 Electron `userData` 경로의 `state.json`에 저장됩니다.

저장 내용:

- 창 위치
- 등록한 위젯 목록
- 알림 활성화 여부
- 각 위젯의 임계치 설정

## 프로젝트 구조

```text
build/
  after-pack.js        # Windows 패키징 후처리
  icon.ico
  icon.png
src/
  main/
    main.js            # 트레이, 윈도우, 폴링, IPC, 알림
    preload.js         # renderer <-> main bridge
    quote-provider.js  # yahoo-finance2 래퍼
    store.js           # state.json 영속화
  renderer/
    index.html         # 프레임리스 UI
    app.js             # 위젯 렌더링/이벤트 처리
    styles.css         # 전체 스타일
```

## 동작 메모

- 싱글 인스턴스 앱입니다. 이미 실행 중이면 기존 창을 다시 보여줍니다.
- 위젯은 최대 12개까지 추가할 수 있습니다.
- 폴링이 실패하거나 시세 값이 없으면 카드에 `N/A` 상태가 표시됩니다.
- 창 위치는 저장되지만 초기 기본 크기(`320x240`)로 다시 맞춰집니다.
