# 코스피 지수 시뮬레이터

코스피 구성종목의 실시간 시세를 불러와, 특정 종목의 가격을 임의로
바꿨을 때 코스피 지수가 어떻게 변하는지 보여주는 조회 전용 시뮬레이터입니다.
로그인이나 매수/매도 기능은 없습니다.

## 동작 방식

이 저장소는 두 부분으로 나뉩니다.

- **Next.js 앱** (이 폴더) — 화면과 `/api/kospi` 릴레이 라우트. Vercel에 배포됩니다.
- **[backend/](backend/)** — 토스 API를 실제로 호출하는, 고정 IP를 가진 VM에서
  상시 구동하는 작은 서버. 토스 Open API는 허용된 IP에서만 호출할 수 있는데,
  Vercel Functions는 고정 아웃바운드 IP가 없어서 직접 호출이 불가능하기
  때문입니다. 자세한 배포 방법은 [backend/README.md](backend/README.md) 참고.

1. `backend/`가 토스증권 Open API(`GET /api/v1/prices`)를 짧은 주기(2.5초)로
   상시 폴링해 구성종목의 실시간 현재가를 메모리에 들고 있습니다. 토스 API는
   WebSocket/푸시를 제공하지 않으므로, "실시간"은 이렇게 폴링으로 구현됩니다.
   Next.js의 `/api/kospi` 라우트는 토스를 직접 호출하지 않고, 이 백엔드의
   `GET /snapshot`을 대신 호출해 그대로 전달합니다. 브라우저는 "실시간" 토글이
   켜져 있을 때 이 `/api/kospi`를 3초 주기로 폴링합니다.
2. 토스 API는 "코스피 전종목 리스트"나 "코스피 지수 자체"를 조회하는
   엔드포인트를 제공하지 않습니다. 그래서 `backend/`는 아래 값을 별도의
   정적 스냅샷(`data/kospiConstituents.json`, `backend/data/`에 복사본 보관)
   에서 가져오고, 런타임에 data.go.kr/DART를 호출하지 않습니다.
   - 코스피 구성종목 코드/이름/상장주식수 (data.go.kr)
   - 보통주 종목의 상장주식수는 DART(전자공시) 사업보고서의 "유통주식수"
     (자기주식 제외)로 대체합니다 — KRX가 지수 계산에 실제로 쓰는 방식과
     맞추기 위함입니다. 값이 비정상적으로 크면(발행주식수 초과 등) data.go.kr
     값을 그대로 둡니다. 우선주는 종목별로 분리해서 받을 방법이 없어 보정하지
     않습니다.
   - 기준시가총액 캘리브레이션 상수 (`기준시가총액 = 전체 시가총액 / (실제 코스피 지수 / 100)`)
3. 코스피 지수 자체는 매 폴링마다 `backend/`가
   `(전종목 실시간 시가총액 합계 / 기준시가총액) × 100`으로 직접 계산합니다 —
   토스로부터 지수값을 받는 게 아니라 구성종목 가격으로부터 역산합니다.
4. 브라우저는 응답받은 전종목 시세를 상태로 보관하고, 사용자가 특정 종목의
   가격을 바꾸면 그 종목만 override된 시가총액으로 교체해 전체 합계와
   시뮬레이션 코스피 지수를 즉시 재계산합니다. override는 실시간 폴링과
   무관하게 유지되며, 사용자가 직접 초기화하기 전까지 사라지지 않습니다.

## 환경변수

Next.js 앱(`.env.local`)에는 백엔드 릴레이 주소만 있으면 됩니다:

```bash
BACKEND_URL=http://<백엔드_VM_공인IP>:4000
BACKEND_SECRET=백엔드와_동일한_공유_비밀키
```

토스 자격증명(`TOSS_CLIENT_ID`/`TOSS_CLIENT_SECRET`)은 더 이상 이 앱(Vercel)에
필요 없습니다 — [backend/](backend/)에만 설정합니다. `DATA_GO_KR_SERVICE_KEY`,
`DART_API_KEY`, 그리고 로컬 테스트용 `TOSS_CLIENT_ID`/`TOSS_CLIENT_SECRET`는
`npm run seed:kospi` / `npm run recalibrate` 같은 로컬 유지보수 스크립트를
실행할 때만 필요합니다 (`.env.example` 참고).

## 허용 IP (Allowlist) / 고정 IP가 필요한 이유

토스 개발자센터는 API를 호출하는 서버의 아웃바운드 IP를 미리 등록해둬야
합니다. **Vercel Functions는 고정 아웃바운드 IP가 없어서**, Next.js 앱이
토스를 직접 호출하는 구조로는 이 조건을 만족할 수 없습니다 — 이게 바로
`backend/`가 별도로 존재하는 이유입니다. 실제 토스 호출은 고정 IP를 가진
VM(`backend/`)에서만 일어나고, Vercel은 그 VM에 결과만 물어봅니다.

- **로컬에서 `npm run seed:kospi` / `npm run recalibrate` 실행 시**: 현재 PC의
  공인 IP(`curl ifconfig.me`)를 등록합니다. 가정용 회선은 IP가 유동적이라
  주기적으로 바뀔 수 있으니, 갑자기 401/403이 나면 IP가 바뀌었는지부터
  확인하세요.
- **배포된 실시간 폴링**: `backend/`를 배포한 VM의 고정 공인 IP를 등록합니다.
  자세한 내용은 [backend/README.md](backend/README.md) 참고.

## 코스피 구성종목 스냅샷 생성/갱신

```bash
# .env.local에 DATA_GO_KR_SERVICE_KEY를 설정한 뒤
npm run seed:kospi
```

`data/kospiConstituents.json`에 구성종목 코드/이름/상장주식수와 기준시가총액
캘리브레이션 상수를 기록합니다. **이 파일을 다시 생성한 뒤에는
`backend/data/kospiConstituents.json`에도 복사해서 배포된 백엔드를
재시작해야** 실제로 반영됩니다 (`backend/`는 자기 폴더 안의 복사본만 읽습니다).
코스피 구성종목이 크게 바뀌거나(신규 상장/상장폐지) 캘리브레이션이 실제
지수와 눈에 띄게 어긋나면 다시 실행해 갱신하세요.

### 캘리브레이션만 다시 맞추기 (`npm run recalibrate`)

data.go.kr은 영업일 기준 다음날 오후 1시 이후 갱신되는 게 원칙이지만, 실제로는
그보다 훨씬 오래(며칠~1주일 이상) 최신 데이터가 안 올라오는 경우가 있습니다.
이럴 때 구성종목 리스트/주식수는 그대로 두고, 기준시가총액만 **지금 실제로
보이는 코스피 지수 값**에 맞춰 다시 계산할 수 있습니다:

```bash
npm run recalibrate -- 7648.09   # 토스/네이버 등에서 지금 보이는 실제 코스피 값
```

토스 실시간가로 지금 시점의 전체 시가총액을 계산하고, 그 값을 입력한 지수로
나눠 `baseMarketCap`을 다시 맞춥니다. 구성종목/주식수는 건드리지 않으므로
`npm run seed:kospi`보다 훨씬 가볍고, data.go.kr이 막혀있어도 실행할 수
있습니다. 이것도 실행 후엔 `backend/data/kospiConstituents.json`으로 복사하고
백엔드를 재시작해야 반영됩니다.

## 로컬 실행

로컬에서도 백엔드가 떠 있어야 `/api/kospi`가 응답합니다 — 터미널 두 개를
씁니다.

```bash
# 터미널 1: 백엔드
cd backend
cp .env.example .env   # TOSS_CLIENT_ID/SECRET, BACKEND_SECRET 채우기
npm start

# 터미널 2: Next.js 앱 (루트에서)
npm install
npm run seed:kospi   # 최초 1회 (또는 데이터 갱신 시) — DATA_GO_KR_SERVICE_KEY 필요
cp data/kospiConstituents.json backend/data/kospiConstituents.json
npm run dev
```

`.env.local`의 `BACKEND_URL`이 `http://localhost:4000`을, `BACKEND_SECRET`이
`backend/.env`와 같은 값을 가리키는지 확인하세요.
[http://localhost:3000](http://localhost:3000) 접속 후 코스피 지수가 실시간으로
갱신되는지 확인할 수 있습니다.

## 배포

1. **backend/**: 고정 IP를 가진 VM(네이버클라우드 등)에 배포합니다. 자세한
   내용은 [backend/README.md](backend/README.md) 참고. 이 VM의 고정 IP를
   토스 개발자센터 허용 IP 목록에 등록합니다.
2. **Next.js 앱 (Vercel)**:
   - GitHub 저장소를 Vercel 프로젝트로 연결합니다.
   - Vercel 프로젝트 설정 → Environment Variables에 `BACKEND_URL`,
     `BACKEND_SECRET`을 등록합니다 (1번 백엔드의 주소와 동일한 비밀키).
   - `data/kospiConstituents.json`은 저장소에 커밋된 파일을 그대로 사용하므로
     별도의 DB, Blob/KV 스토리지, Cron Job 설정은 필요하지 않습니다.

## 알려진 제약

- 토스 Open API는 클라이언트 × API 그룹 단위로 초당 요청 수(TPS)가
  제한됩니다 (시세 조회 그룹 기준 초당 10회). 구성종목 수가 많아지면
  200개씩 나눠 여러 번 호출하므로, 방문자가 아주 많아지는 경우 폴링
  주기(`backend/`의 `POLL_INTERVAL_MS`, 프론트엔드의 `LIVE_POLL_MS`)를
  늘리는 것을 검토해야 합니다.
- `data/kospiConstituents.json`은 생성 시점의 스냅샷이라, 신규 상장/상장폐지나
  대규모 유상증자 등으로 상장주식수·구성종목이 크게 바뀌면 `npm run
  seed:kospi`로 다시 생성하기 전까지는 실제 코스피와 오차가 커질 수 있습니다.
- 코스피 지수는 구성종목 실시간 가격으로부터 역산한 근사치이며, KRX의 공식
  지수 산출 방법론(관리종목 처리, 정확한 반영 시점 등)과 완전히 일치하지
  않을 수 있습니다. `npm run recalibrate`로 특정 시점의 절대값은 맞출 수
  있지만, 그 이후 시간이 지나면서 다시 미세하게 어긋날 수 있습니다. 투자
  판단에 사용할 수 없는 교육·시뮬레이션 목적의 도구입니다.
