# HANDOVER — 코인 시세 추적 전용 (coin-total)

- 작성: 2026-10-01 23:19 KST 읽기 점검 직후 (시간대 Asia/Seoul). 아래 상태 숫자는 모두 이 점검 기준.
- GitHub 사본: 2026-10-02 사용자 지시로 이 문서를 `docs/HANDOVER.md`로 올렸어요 (https://github.com/jtl10231-oss/coin-total/blob/main/docs/HANDOVER.md). 저장소가 공개라 누구나 볼 수 있어요. 이 문서의 시각과 숫자는 여전히 10/1 23:19 기준이고, 다시 확인하지 않았어요.
- 이전 담당: Aside 세션 `2026-09-27_4jC2xnQrzokhKbPE` → 이 문서를 쓴 뒤 멈춤 (§13)
- 새 담당: 사용자가 승인한 새 Aside 스레드 (단독 소유)
- 일부러 뺀 것: 토큰·비밀값, 보유 수량·매입가·평가금액·예산·잔액 같은 개인 금융 숫자, 이름·이메일, 텔레그램 단체방 번호·봇 이름, 중계 서버 주소

---

## 0. 최신 권한 (이 문서의 다른 내용보다 우선)

- 할 수 있는 일: 가격 추적이 잘 돌고 있는지 **읽어서 확인하고 사용자에게 보고**하는 것
- 예외 1회: 2026-10-02 사용자가 "깃헙에 올려서 배포해"라고 지시해서, 이 문서 하나(`docs/HANDOVER.md`)만 올렸어요. 코드·data·워크플로·비밀값은 안 바꿨어요. 이 지시는 한 번뿐이고, 아래 금지는 그대로예요.
- 사용자에게 새로 승인받기 전에는 하면 안 되는 일
  - 매수·매도·이체. 거래소 API 키는 원래 없고, 새로 만들지도 말 것
  - 새 게시: `coin-total`·`runway-data` 커밋, GitHub Pages 배포, 새 공개 링크나 게시물
  - 유료 서비스
  - 권한 확장: 새 토큰이나 범위, 비밀값 추가·변경, 계정 권한 변경
  - 재시작: 실행 Cancel, Run workflow, Re-run, Disable/Enable
- 함정: 진행 중인 `collect-coinone` 실행은 **Cancel만 해도 새 실행이 바로 켜짐**. 마지막 단계 `start next run`이 `if: always()`라서 그래요. 그래서 취소도 재시작이고, 금지예요.

## 1. 범위

- 포함
  - 공개 코인 페이지 https://jtl10231-oss.github.io/coin-total/
    - 저장소: `jtl10231-oss/coin-total` (공개)
    - Pages 설정: Deploy from a branch, `main`, `/ (root)`, HTTPS 강제
  - 1분 수집 루프(워크플로 `collect-coinone`)와 `data` 브랜치 데이터
  - 센티멘트, 1일·3일·7일·2주 시나리오 예측, 주요 뉴스
  - 텔레그램 코인 급변 알림 (두 코인 합산 평가금액 기준)
- 제외: 다른 소유 범위라 건드리지 말 것
  - 같은 저장소의 `runway/` 가계 앱 (예산, 통장, 기록 화면)
  - 비공개 저장소 `jtl10231-oss/runway-data`
  - 구글 Apps Script 중계 서버
  - 단, 알림이 보유 수량을 Runway 기록에서 읽어요. 그래서 이 부분만 의존성으로 적어요(§2.4, §10, §12).

## 2. 구성

### 2.1 공개 코인 페이지 (`index.html`)
- **실시간 시세**
  - 브라우저에서 코인원 WebSocket `wss://stream.coinone.co.kr`의 TICKER(KRW-SOL, KRW-WLD)를 구독해요.
  - 60초마다 PING을 보내고, 끊기면 3초 뒤 다시 연결해요.
- **화면에 나오는 것**
  - 총 평가금액과 매입 원가 대비 수익률
  - 코인별 현재가, 24시간 등락, 평가금액, 수익률
  - 보유 수량과 매입가는 파일 안 `coins` 상수에 있어요. 값은 이 문서에 적지 않았어요.
- **1분 차트**
  - 데이터: `data/history.json`(7일치) + 페이지를 열어 둔 동안 받은 실시간 값 + 브라우저 `localStorage`의 `liveTotals_<수량>`
  - 기간 버튼은 1시간, 6시간, 24시간, 7일이고, 매입 원가는 본전선(점선)으로 보여요.
- **센티멘트·예측 표**: `data/forecast.json`을 10분마다 다시 읽어요.
- **뉴스**: `data/news.json`을 3분마다 다시 읽어요.
- **상단 탭** "코인 | 런웨이": 런웨이 탭은 범위 밖이에요.
- **홈 화면 추가 관련 파일**
  - `sw.js`는 같은 출처의 GET 요청만 네트워크로 그대로 넘겨요. 캐시는 하지 않아요.
  - `manifest.webmanifest`와 아이콘 3개가 있어요.
  - 설치 버튼은 사용자 요청으로 뺐고, 파일만 남아 있어요.
- 금액은 최근 체결가 기준이에요. 수수료와 세금은 빼지 않았어요.

### 2.2 1분 수집 루프 (`.github/workflows/collect.yml`, 이름 `collect-coinone`)
- **`workflow_dispatch` 실행 (주력)**
  - 340분 동안 매분 `bash publish.sh`와 `bash runway_tick.sh`를 돌려요. `runway_tick.sh`는 지금 `exit 0`만 해요.
  - 루프가 끝나면 `start next run` 단계가 `gh workflow run collect.yml --ref main`으로 다음 실행을 스스로 켜요.
  - 시간 제한은 `timeout-minutes: 355`이고, 한 바퀴는 약 5시간 40분 14초예요.
- **`schedule: */10 * * * *` (보조 감시)**
  - 진행 중이거나 대기 중인 dispatch 실행이 없으면 새로 켜요.
  - `publish.sh`도 한 번 돌리는데, 이때는 알림을 보내지 않아요.
  - GitHub 예약 실행은 불규칙해요. 9/27에는 약 5시간 동안 한 번도 안 돌았고, 9/27 밤~9/28 낮 13시간 동안 3번만 돌았어요.
- **권한과 비밀값**
  - 권한: `contents: write`, `actions: write`
  - `GH_TOKEN`에 워크플로 기본 토큰(`github.token`)을 넣어, data 브랜치에 푸시하고 다음 실행을 켜요.
  - concurrency 설정은 없어요.
- **루프 단계 환경값**
  - secrets: `RUNWAY_DISPATCH_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
  - `TELEGRAM_CHAT_ID`는 설정하지 않았고, 없어도 돼요.
  - `PRICE_ALERT='1'`
- **코드 반영 시점**: 각 실행은 시작할 때 `main`을 checkout해요. 그래서 코드를 바꾸면 다음 바퀴부터 반영돼요. Node는 20이에요.

`publish.sh`가 매분 하는 일 (순서대로):
1. `git fetch -q origin +refs/heads/data:refs/remotes/origin/data`
2. `node collect.mjs /tmp/history.json`
   - 코인원 1분봉 종가를 500개씩 거꾸로 받아요.
   - 이전 기록과 합쳐서 7일치(10,080분)를 보관하고, 빈 분은 앞의 값으로 채워요.
3. `node forecast.mjs /tmp/forecast.json || true`
   - 55분이 안 지났으면 이전 값을 그대로 둬요.
   - 보유 설정(`holdKey`)이 바뀌면 다시 계산해요.
4. `/tmp/news.json`이 240초보다 오래됐으면 `node news.mjs`
5. 알림
   - `/tmp/alert_state.json`이 없으면 `origin/data`에서 가져와요.
   - `PRICE_ALERT=1`이면 `node price_alert.mjs /tmp/history.json /tmp/alert_state.json || true`
6. 저장
   - `/tmp/pub`에 새 git 저장소를 만들고 JSON 4개를 커밋해요.
   - `HEAD:data`로 강제 푸시해요. data는 고아 브랜치라 커밋이 1개만 남아요.

### 2.3 `data` 브랜치 파일 (공개)
| 파일 | 내용 | 갱신 주기 |
|---|---|---|
| `history.json` | `{updated,t0,step:60000,SOL[],WLD[]}` 코인원 1분 종가, 7일치(10,081개) | 매분 |
| `forecast.json` | 센티멘트(시장·SOL·WLD), 1·3·7·14일 시나리오, `holdKey`·`TOTAL` | 약 1시간 |
| `news.json` | 코인별 중요 뉴스 최대 3개 + `SOL_latest`/`WLD_latest` | 약 5분 |
| `alert_state.json` | `lastT`, `th{v,t}`, `td{v,t}`, `hello`, `chat`, `hold{q,at}` | 매분 |

- 아래 값에는 개인 금융 숫자나 단체방 번호가 들어 있어요. 진단할 때 출력하지 마세요. §7 명령은 시각만 출력하게 만들었어요.
  - `forecast.json`: `holdKey`, `TOTAL`
  - `alert_state.json`: `th.v`, `td.v`, `hold.q`, `chat`

### 2.4 텔레그램 코인 급변 알림 (`price_alert.mjs`, 지금 쓰는 기준)
- **대상**: SOL과 WLD 합산 평가금액 (보유 수량 × 1분 종가)
- **규칙**
  - `th`: 최근 60분 안의 최저점보다 +1.7% 이상 오르거나, 최고점보다 −1.7% 이하로 내리면 알림
  - `td`: 최근 1,440분 기준, ±5%
  - 오르고 내린 조건이 둘 다 맞으면 더 크게 움직인 쪽으로 보내요.
- **다시 보내는 조건**: 마지막으로 알린 금액에서 한 칸(1.7% 또는 5%)을 더 움직이거나, 그 규칙의 시간 창이 지나야 해요.
- **평가와 재시도**
  - 1분에 한 번만 평가해요(`lastT`).
  - 전송에 실패하면 그 규칙 상태를 되돌려서 다음 분에 다시 시도해요.
  - 그래서 `th.t`와 `td.t`는 "마지막으로 실제 전송에 성공한 시각"이에요.
- **보유 수량**
  - 10분마다 Runway 기록을 중계 서버에서 GET으로 읽어요. 주소는 파일 안 `API` 상수(Apps Script 웹앱)예요.
  - 읽은 기록을 `require('./runway/core.js').compute(ledger,{SOL:1,WLD:1},now).hold`로 계산해요. 그래서 매도를 기록하면 반영돼요.
  - 읽기에 실패하면 마지막 값을 쓰고, 그것도 없으면 파일 안 `DEFAULT_Q`를 써요.
- **단체방 찾기**
  - `TELEGRAM_CHAT_ID`가 없으면 `getUpdates`에서 group이나 supergroup을 찾아 `alert_state.json.chat`에 저장해요.
  - 단체방이 supergroup으로 바뀌는 경우(`migrate_to_chat_id`)도 처리해요.
  - 봇은 그룹 메시지를 다 읽을 수 없는 설정(privacy mode)이에요. 그래서 처음에 사용자가 단체방에 `/start@봇이름`을 보내서 찾았어요(9/28 13:34).
  - 단체방을 새로 찾으면 runway-data `check.yml`을 dispatch해요(`tellRunway`). 그 워크플로는 꺼져 있어서 실제로 실행되지는 않아요. 로그에 HTTP 상태만 남을 것으로 예상하는데, 확인은 안 했어요.
- **안내문 버전 `hello`**
  - 1 = 처음 켜짐, 2 = 코인별 2%/7%, 3 = 합산 1.7%/5% (지금 값)
  - 기준을 바꾸면(승인 필요) 숫자를 올려서 단체방에 한 번 안내해요.
- **메시지 내용**
  - 합계 변화율과 금액(만원), 시작 시각(어제면 "어제 HH:MM")
  - 코인별 변동률과 가격, 보유 수량, 런웨이 링크
  - 비공개 단체방으로만 가요.

### 2.5 예측·뉴스
- **`forecast.mjs`**
  - 센티멘트(0~100점)
    - 시장 = 공포·탐욕 지수 50% + BTC 7일 추세 30% + 전체 시가총액 24시간 변화 20%
    - 코인 = 7일 추세 45% + RSI(14) 35% + CoinGecko 투표 20%
  - 시나리오
    - 변동폭 σ는 최근 90일 일별 로그수익률의 표준편차예요.
    - 중간 = 센티멘트(코인 60% + 시장 40%)로 σ√일수의 최대 25%까지만 기울인 값
    - 긍정과 나쁨 = 중간에서 ±σ√일수 (그 사이에 들어올 확률을 68%로 가정)
    - 페이지에 "투자 조언 아님"을 적어 뒀어요.
  - 보유 수량과 매입가는 파일 안 `HOLD` 상수예요(값은 생략).
- **`news.mjs`**
  - 출처: Google News RSS(한국어 + 영어 주요 매체만), 최근 2일
  - 주제어에 점수를 줘요. ETF·승인, 상장폐지, 해킹, 장애, 규제·소송, 업그레이드, 언락, 기관 자금 같은 것들이에요.
  - 단순 시세 기사는 감점해요. 비슷한 제목(3글자 조각 비교)은 중복으로 빼고, 같은 주제는 1개만 남겨요.
  - 코인별로 최대 3개를 골라요. 먼저 24시간 안에서 찾고, 모자라면 48시간까지 봐요.
  - 거래소 공지와 저품질 출처는 차단 목록으로 빼요.

### 2.6 외부 데이터 (모두 무료, 키 없음)
- **코인원 REST**
  - 차트: `https://api.coinone.co.kr/public/v2/chart/KRW/{SOL|WLD|BTC}?interval=1m|1d&size=<=500[&timestamp=<ms>]`. size를 1,000으로 하면 `error_code 317`이 나와요.
  - 현재가: `https://api.coinone.co.kr/public/v2/ticker_new/KRW/{SYM}`
  - 브라우저에서는 CORS로 막혀서, 서버(Actions)에서만 불러요.
- **코인원 WebSocket**: 브라우저에서 바로 돼요.
- **센티멘트용**: `https://api.alternative.me/fng/`, CoinGecko `api/v3/global`·`api/v3/coins/solana`·`api/v3/coins/worldcoin-wld`
- **뉴스**: Google News RSS `https://news.google.com/rss/search`
- **알림**: Telegram Bot API `sendMessage`, `getUpdates`
- **raw.githubusercontent.com**: CORS는 허용되지만 약 5분 캐시가 있어요. 그래서 페이지 차트 끝 몇 분이 평평하게 보일 수 있어요. 실시간 값으로 채워져요.

## 3. 결정 기록 (사용자 결정, 확인된 사실, 제안을 구분)

KST 시각순:
- 9/27 16:5x
  - [사용자] 코인원 기준 SOL·WLD 총액 페이지를 원했고, 외부에서 열 수 있는 링크를 원함 → GitHub Pages 공개 저장소로 만듦
  - [사실] 이때 사용자에게 "공개라서 링크를 아는 사람은 누구나 수량과 금액을 볼 수 있다"고 알렸고, 이후 비공개 요청은 없었음
- 9/27 17:0x
  - [사용자] 코인 수량은 고정
  - [사용자] 수익률은 매입 원가 대비 하나만, 매입 원가 금액은 화면에 표시하지 않음
- 9/27 17:0x~17:2x
  - [사용자] 아이폰 위젯은 안 함
  - [사용자] 홈 화면 추가 버튼은 넣었다가 빼달라고 함
  - [사용자] 1분 단위 금액 변화 차트를 원함
- 9/27 17:2x
  - [사용자] 시장·솔라나·월드코인 센티멘트, 1일·3일·7일·2주 예측, 한 줄 뉴스를 원함
- 9/27 18:2x
  - [사용자] 예측을 긍정/중간/나쁨 시나리오와 그때의 총액으로 바꿔달라고 함
- 9/27 22:4x
  - [사실] 5분 예약 실행이 5시간 넘게 안 돌아서 차트에 빈 구간이 생김
  - [이전 담당 결정] 1분 루프와 스스로 다음 실행을 켜는 방식으로 바꿈
- 9/27 23:4x
  - [사용자] 뉴스는 실시간 중요 뉴스로 → 5분 주기와 주제어 선별 방식으로 분리
- 9/28 11:5x
  - [사용자] 보유 수량을 한 번 바꿈(값 생략)
- 9/28 13:1x
  - [사용자] 1시간 ±1%, 하루 ±5% 텔레그램 알림을 원함 (봇과 단체방은 사용자가 준비)
- 9/28 13:4x
  - [사용자] 텔레그램은 코인 알림만
  - runway-data `runway-check` 워크플로를 Disable하고 `runway_tick.sh`를 `exit 0`으로 바꿈
- 9/28 13:53
  - [사용자] 기준을 1시간 2%, 하루 7%로 바꿈
- 9/28 14:0x
  - [사용자] 하루 평균 5번 정도를 원함
  - [제안] 월드코인만 1시간 3.5%로
  - [사용자] 두 코인을 합산한 기준이면 어떤지 물음
  - [사용자 확정] 합산 1시간 1.7%, 하루 5%. 보유 수량은 Runway 기록을 따라감
- 2026-10-01
  - [사용자] 최신 권한: 가격 추적만 (§0)

[제안·미결정] 아직 아무것도 실행하지 않았고, 하려면 사용자 승인이 필요해요.
- 봇 토큰 재발급
  - 사용자가 대화에 토큰을 평문으로 붙여 넣은 적이 있어요. 아직 사용자에게 제안하지 않았어요.
  - 하려면 BotFather에서 다시 발급하고, 비밀값 2곳(§9)을 바꿔야 해요.
- 공개 data 브랜치에 개인 값이 드러나는 문제 줄이기 (§10-1)
- 페이지와 예측의 보유 수량을 Runway 기록과 맞추기 (§10-2)
- 실제 알림 횟수를 세어 본 뒤 기준을 조정할지

## 4. 완료 증거

2026-10-01 23:19 KST 읽기 점검 (§7 명령으로 확인):
- **수집 루프**
  - 현재 실행 `36862037199`: workflow_dispatch, in_progress, 10/1 21:28:58 시작
  - 직전 실행 `36826783023`: dispatch, completed success, 15:48:44 시작 → 스스로 다음 실행 켜기가 정상
  - 예약 감시: `36872238151` (22:54:49 success), `36825741158` (15:37:13 success)
- **데이터**
  - `data` 브랜치 마지막 커밋 23:18:30
  - `history.json`: updated 23:18:29, 10,081개, 마지막 분 23:18
- **알림 상태 (`alert_state.json`)**
  - `hello` 3, `lastT` 23:18
  - `th` 마지막 전송 성공 10/1 16:27, `td` 마지막 전송 성공 10/1 01:47 (상태 파일 규칙으로 판단한 값이에요. 로그나 단체방으로 다시 보지는 않았어요)
  - 보유 수량 갱신 23:12:36 (중계 서버 읽기 성공), 단체방 번호 저장돼 있음
- **기타**
  - `forecast.json` 22:43:34, `news.json` 23:16:30
  - 코인원 ticker 응답 `result: success`
- **파일**: 로컬 사본(§11)의 파일 14개가 GitHub `main`과 바이트 단위로 같음

이전 증거 (9/27~9/28):
- 스스로 다음 실행 켜기 첫 확인: 9/27 23:49 → 9/28 05:29 → 11:09 자동 연결
- 텔레그램
  - 9/28 13:35경 첫 안내를 보냄
  - 14:06경 합산 기준 안내와 첫 `td` 하락 알림을 보냄
  - 근거: 실행 `36380376374` 로그 `hello: sent`, `price alert: tddown sent`
- `runway-check` 워크플로가 Disabled인 화면을 9/28 13:4x와 14:3x에 확인
  - 10/1에는 다시 확인하지 못했어요. 비공개 저장소라 비로그인 API로는 볼 수 없고, 이번에는 브라우저를 열지 않았어요.
- 알림 기준 백테스트 (9/22~9/28, 1분 데이터 6일치)
  - 코인별 1%/5%: 하루 51.5번
  - 코인별 2%/7%: 하루 14.5번
  - 합산 1.7%/5%: 하루 4.8번 (6일 동안 1시간 규칙 27번, 하루 규칙 4번)
  - 실제 운영 중 알림 횟수는 아직 세지 않았어요.

## 5. 체크포인트 상태

- 진행 중인 코드 작업은 없어요. 커밋 안 된 변경도 없어요.
- 코드 커밋은 `c220bf3`(9/28 15:10:44)가 마지막이고, 그 뒤로 코드를 바꾼 커밋은 없어요. 10/2에 이 문서(`docs/HANDOVER.md`) 커밋 하나만 더 생겼어요.
- 실시간 추적은 GitHub Actions에서 계속 돌고 있어요. 이 스레드의 프로세스가 아니에요.
- 다음 자동 연결 예상
  - 10/2 03:09경 KST (21:28:58 + 약 5시간 40분 14초)
  - 그 뒤 약 5시간 40분마다: 08:49경, 14:30경, 20:10경… (바퀴마다 15초 정도씩 늦어져요)
  - 예약 감시는 언제 돌지 일정하지 않아요.

## 6. 남은 순서 (새 담당, 지금 권한 안에서)

1. **시작 점검**: §7 명령 1~5를 돌려요. 아래 셋이 모두 맞으면 정상이에요.
   - dispatch 실행이 1개 in_progress
   - data 브랜치 커밋이 3분 이내
   - `alert_state.lastT`가 3분 이내
2. **10/2 03:09경 연결 확인**
   - 새 workflow_dispatch 실행이 생겼는지
   - 직전 실행이 success로 끝났는지
   - data 갱신이 끊기지 않았는지
3. **정기 점검** (하루 1~2번 권장): 1번의 세 가지 + `forecast` 70분 이내 + `news` 10분 이내
4. **알림 횟수 세기** (읽기만)
   - 실행 로그에서 `price alert:`와 `sent`가 들어간 줄을 날짜별로 세요.
   - 하루 5번 목표와 비교해서 사용자에게 보고해요. 기준을 바꾸는 건 승인을 받은 뒤예요.
5. **이상이 보이면**
   - §7과 §10으로 원인을 찾아 사용자에게 보고하고 승인을 요청해요.
   - 직접 재시작하거나 고치지 마세요.
6. **사용자 결정이 필요한 항목** (§3 제안·미결정): 필요할 때 한 번에 하나씩, 추천안을 맨 앞에 "(추천)"으로 붙여서 물어요.

## 7. 진단 명령 (읽기 전용)

1~8번은 2026-10-01 23:19 KST에 실제로 돌려서 확인했어요. GitHub 비로그인 API는 IP당 시간당 60번까지예요.

```bash
# 1. collect-coinone 최근 실행 (실행 ID, 종류, 상태, 결과, 시작 시각)
curl -s "https://api.github.com/repos/jtl10231-oss/coin-total/actions/workflows/collect.yml/runs?per_page=4" \
| node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const K=x=>new Date(x).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"});(JSON.parse(s).workflow_runs||[]).forEach(r=>console.log(r.id,r.event,r.status,r.conclusion||"-",K(r.created_at)))})'

# 2. data 브랜치 마지막 커밋 시각 (캐시 없음)
curl -s "https://api.github.com/repos/jtl10231-oss/coin-total/branches/data" \
| node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(new Date(j.commit.commit.committer.date).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}))})'

# 3. history.json 갱신 시각, 개수, 마지막 분 (raw는 최대 5분 캐시)
curl -s "https://raw.githubusercontent.com/jtl10231-oss/coin-total/data/history.json?t=$(date +%s)" \
| node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s),K=x=>new Date(x).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"});console.log("updated",K(h.updated),"| points",h.SOL.length,"| last minute",K(h.t0+(h.SOL.length-1)*h.step))})'

# 4. alert_state.json — 시각만 출력 (금액, 수량, 단체방 번호는 출력하지 않음)
curl -s "https://raw.githubusercontent.com/jtl10231-oss/coin-total/data/alert_state.json?t=$(date +%s)" \
| node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s),K=x=>x?new Date(x).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}):"-";console.log("hello",a.hello,"| lastT",K(a.lastT),"| th",a.th?K(a.th.t):"-","| td",a.td?K(a.td.t):"-","| hold 갱신",a.hold?K(a.hold.at):"-","| chat 저장",!!a.chat)})'

# 5. forecast / news 갱신 시각
for f in forecast news; do curl -s "https://raw.githubusercontent.com/jtl10231-oss/coin-total/data/$f.json?t=$(date +%s)" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(process.argv[1],new Date(JSON.parse(s).updated).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})))' "$f"; done

# 6. 코인원 응답 확인
curl -s https://api.coinone.co.kr/public/v2/ticker_new/KRW/SOL | head -c 120; echo

# 7. 로컬 사본과 GitHub main이 같은지 (same/DIFF)
R=/Users/jaylee/.aside/u/0/sessions/2026-09-27_4jC2xnQrzokhKbPE/artifacts/repo
for p in index.html sw.js manifest.webmanifest icon-192.png icon-512.png apple-touch-icon.png collect.mjs forecast.mjs news.mjs price_alert.mjs publish.sh runway_tick.sh .github/workflows/collect.yml runway/core.js; do
  curl -s "https://raw.githubusercontent.com/jtl10231-oss/coin-total/main/$p?t=$(date +%s)" | cmp -s - "$R/$p" && echo "same $p" || echo "DIFF $p"; done

# 8. main 커밋 목록 (SHA 7자리, 시각, 메시지)
curl -s "https://api.github.com/repos/jtl10231-oss/coin-total/commits?sha=main&per_page=100" \
| node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>JSON.parse(s).forEach(c=>console.log(c.sha.slice(0,7),new Date(c.commit.author.date).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}),"|",c.commit.message.split("\n")[0])))'

# 9. 실행 하나의 job ID와 단계 상태
#    (9/28에 같은 API를 비로그인으로 썼음. 이 한 줄은 이번엔 돌리지 않았음)
RUN=36862037199; curl -s "https://api.github.com/repos/jtl10231-oss/coin-total/actions/runs/$RUN/jobs" \
| node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s).jobs[0];console.log("job",j.id,j.status);j.steps.forEach(x=>console.log(" -",x.name,x.status,x.conclusion||"-"))})'
```

**로그 읽기**
- 로그인된 브라우저에서 `https://github.com/jtl10231-oss/coin-total/actions/runs/<RUN_ID>/job/<JOB_ID>`를 열고, "collect every minute (about 5h40m)" 단계를 펼쳐요.
- `points` 줄의 시각은 UTC(Z)예요.

| 로그 줄 | 뜻 |
|---|---|
| `points 10081 <시작> -> <끝>` | 수집 정상 |
| `skip (recent)` | 예측은 1시간 간격이라 건너뜀 (정상) |
| `hello: sent` / `no-chat` / `fail:…` | 안내문 전송 결과 |
| `price alert: thup`·`thdown`·`tdup`·`tddown` + `sent` / `no-chat` / `fail:…` | 알림 전송 결과 |
| `holdings fetch failed: …` | 보유 수량 읽기 실패 (마지막 값으로 계속) |
| `price alert error: …`, `publish failed, retry next minute` | 오류 |
| `runway chat handoff: <HTTP 상태>` | 단체방 번호를 런웨이 쪽에 넘김 (지금은 효과 없음) |

**텔레그램 상태**
- 봇 토큰은 GitHub 비밀값에만 있어서, 새 담당이 Telegram API를 직접 부를 수는 없어요.
- 전송 여부는 로그의 `sent` 줄과 `alert_state.json`의 `th.t`·`td.t` 갱신으로 판단해요.

## 8. 재시작·변경 방법 (참고용, 지금 권한으로는 하면 안 됨)

- **루프가 멈췄는지 판단**
  - in_progress인 dispatch 실행이 없고, data 브랜치 커밋이 15분 넘게 오래되면 멈춘 거예요.
  - 먼저 예약 감시가 스스로 켜는지 기다려요. 보통 10분에서 몇 시간 걸리고, 일정하지 않아요.
- **(승인 후) 다시 켜기**
  - 로그인된 브라우저에서 https://github.com/jtl10231-oss/coin-total/actions/workflows/collect.yml → Run workflow → `main`
  - 이미 in_progress인 실행이 있으면 하지 마세요. concurrency 설정이 없어서 루프 두 개가 겹치면 알림이 두 번 갈 수 있어요.
- **(승인 후) 코드 반영 방법**
  - 이 컴퓨터에는 `gh` CLI와 git 인증이 없어요.
  - 로그인된 브라우저의 GitHub "Upload files"로 올려요: `https://github.com/jtl10231-oss/coin-total/upload/main[/하위폴더]`. 워크플로 파일은 `/upload/main/.github/workflows`로 올려요.
  - 올리기 전에 로그인 계정이 저장소 소유 계정인지 확인하세요. 브라우저가 다른 GitHub 계정으로 바뀌어 업로드가 막힌 적이 있어요.
  - Pages는 1~2분 안에 자동으로 배포돼요.
  - 실행 중인 루프는 다음 바퀴부터 새 코드를 써요. 바로 쓰려면 Cancel해야 하는데, 그게 재시작이에요.
- **완전히 멈추기**: Actions에서 Disable workflow (승인 필요)
- **진행 중인 실행은 Cancel하지 마세요**: 새 실행이 바로 켜져요.

## 9. 비용·권한 제약

- **비용은 0원으로 운영 중**
  - GitHub Actions 표준 러너(공개 저장소는 무료), GitHub Pages(공개 저장소)
  - 코인원, alternative.me, CoinGecko, Google News: 키 없이 무료
  - Telegram Bot API: 무료
  - 유료 서비스는 추가하지 마세요.
- **비밀값** (이름만 적었어요. 값은 어디에도 적지 마세요)
  - `coin-total` Actions secrets
    - `TELEGRAM_BOT_TOKEN`
    - `RUNWAY_DISPATCH_TOKEN`: fine-grained PAT `runway-dispatch`. runway-data 저장소의 Actions 읽기·쓰기와 Metadata 읽기만 돼요. 2027-09-15 만료.
    - `TELEGRAM_CHAT_ID`는 없어요.
  - `runway-data` Actions secret: `TELEGRAM_BOT_TOKEN`. 이 값을 쓰는 워크플로는 꺼져 있어요.
  - Apps Script 스크립트 속성 `GITHUB_TOKEN`
    - fine-grained PAT `runway-device`. runway-data의 Contents 읽기·쓰기와 Metadata 읽기만 돼요. 2027-09-15 만료.
    - 알림이 보유 수량을 읽을 때 이 값에 의존해요.
  - data 브랜치 푸시와 다음 실행 켜기는 워크플로 기본 `github.token`을 써요. 만료가 없어요.
- **거래 권한**: 거래소 API 키는 없어요. 매수·매도·출금 권한은 처음부터 붙이지 않는다는 원칙이에요(사용자 기획).
- **로컬 환경**
  - `gh` CLI와 git 인증이 없어요.
  - 브라우저는 GitHub에 로그인돼 있어요. 계정은 쓸 때 확인하세요.
  - 텔레그램 웹과 Cloudflare는 로그인 안 돼 있어요. 사용자는 Cloudflare에 더 올리는 걸 원하지 않았어요.

## 10. 알려진 위험·확인 안 된 것

1. **공개 노출**
   - 저장소가 공개라서 아래 값을 누구나 볼 수 있어요.
     - `index.html`의 `coins`, `forecast.mjs`의 `HOLD`, `price_alert.mjs`의 `DEFAULT_Q`에 있는 보유 수량과 매입가
     - `forecast.json`과 `alert_state.json`에 있는 금액, 수량, 단체방 번호
   - 특히 `alert_state.json.hold.q`는 비공개 Runway 기록에서 온 값이에요. 그래서 매도를 기록하면 바뀐 수량이 공개돼요.
   - 사용자에게는 처음에 "공개 저장소"라고만 알렸고, data 브랜치에 무엇이 드러나는지는 따로 말한 적이 없어요. 다음 보고 때 알려야 해요.
   - 중계 서버 주소도 공개 파일에 있어요. 사용자가 로그인 없는 방식을 골라서 그렇고, 그래서 Runway 기록을 누구나 읽고 추가할 수 있어요. Runway 범위라 여기서는 기록만 해 둬요.
   - 고치려면 커밋(게시)이 필요해서 승인을 받아야 해요.
2. **보유 수량 불일치**: 페이지와 예측은 파일 상수를 쓰고, 알림은 Runway 기록을 써요. 매도가 기록되면 페이지와 알림의 수량이 달라져요.
3. **봇 토큰 노출**: 대화에 평문으로 노출된 적이 있어요. 재발급을 권장해요(승인 필요, §3).
4. **GitHub 정책 (확인 안 함)**
   - Actions 약관에 "저장소 소프트웨어와 관련 없는 용도" 제한 조항이 있는 것으로 알고 있는데, 원문은 다시 확인하지 않았어요.
   - 24시간 도는 1분 루프가 제한되거나 중지될 위험이 있어요.
5. **예약 실행 60일 규칙 (확인 안 함)**
   - 공개 저장소에서 60일 동안 활동이 없으면 예약 워크플로가 꺼질 수 있어요.
   - data 브랜치 푸시가 "활동"으로 쳐지는지는 확인 안 했어요.
   - 꺼지더라도 dispatch 루프는 계속 돌아요. 다만 루프가 끊겼을 때 되살려 줄 감시가 없어져요.
6. **루프가 끊기는 경우**: 다음 실행 켜기 실패(GitHub 장애), 러너 대기 지연, 355분 시간 제한. 예약 감시가 보완하지만 언제 돌지 일정하지 않아요.
7. **중계 서버 의존**
   - Apps Script가 가끔 HTML 오류("페이지를 찾을 수 없음", 404)를 돌려줘요. 9/28 15:0x에 한 번 봤고, 바로 정상으로 돌아왔어요.
   - 실패해도 알림은 마지막 수량으로 계속 돌아요.
   - `runway-device` 토큰이 만료되거나(2027-09-15) 폐기되면 수량 갱신이 멈춰요.
8. **텔레그램**
   - `getUpdates` 기록은 24시간만 남아요. 그래서 `alert_state.json.chat`이 사라지면(data 브랜치 초기화 등) 누군가 단체방에 `/start@봇이름`을 다시 보내야 찾을 수 있어요.
   - 웹훅이 설정되면 `getUpdates`가 막혀요. 9/28 기준으로 웹훅은 없었어요.
   - 봇이 단체방에서 빠지면 로그에 매분 `fail`만 남고 알림은 안 가요.
9. **외부 API 변화**: 코인원 응답 형식이나 제한(`error_code`), CoinGecko 무료 사용량 제한, Google News가 Actions IP를 막을 가능성.
10. **캐시**: raw는 약 5분, Pages는 최대 10분 늦게 보일 수 있어요.
11. **알림 횟수**: 하루 4.8번(백테스트)은 월드코인이 크게 흔들린 6일 기준이에요. 실제 횟수는 다를 수 있어요.

## 11. 파일·커밋 위치

- **저장소**: https://github.com/jtl10231-oss/coin-total (공개). 기본 브랜치 `main`, 데이터 브랜치 `data`
- **지금 운영 코드 기준**: `main` @ `c220bf3` (2026-09-28 15:10:44 KST). 그 뒤 코드 커밋 없음 (10/1 23:19 확인). 10/2에 이 문서 커밋만 추가됨
- **코인 관련 주요 커밋** (이 스레드 작업 기록으로 짝지음. 전체 목록은 §7-8)

| 커밋 | 시각 (KST) | 내용 |
|---|---|---|
| `10b6901` | 9/27 16:57 | 첫 코인 페이지 |
| `4f016c1` · `5fc63f1` · `34a24a1` | 9/27 17:01~17:06 | 매입 원가 대비 수익률 하나로 정리, 원가 금액 표시 뺌 |
| `491bd56` | 9/27 17:12 | 1분 차트 + `collect.mjs` |
| `6ef3c33` | 9/27 17:13 | 첫 `collect.yml` |
| `4508e8c` · `b9e8d20` | 9/27 17:18 · 17:20 | 홈 화면 설정·아이콘·`sw.js` 추가, 설치 버튼 뺌 |
| `8702704` · `ddf2bf0` | 9/27 17:24 | 센티멘트·예측(`forecast.mjs`) + 워크플로 수정 |
| `6b66966` | 9/27 18:21 | 예측을 긍정/중간/나쁨 시나리오로 |
| `d9d4ff9` · `d3d0a4f` | 9/27 22:42 | 1분 루프(`publish.sh`) + 스스로 다음 실행 켜기 |
| `a793a79` | 9/27 23:48 | 뉴스 분리(`news.mjs`, 5분 주기) |
| `48b416f` | 9/28 11:54 | 보유 수량 변경 |
| `74da2c8` | 9/28 12:44 | 상단 "코인 / 런웨이" 탭, `sw.js` 정리 |
| `eaa71ac` | 9/28 12:45 | `collect.yml`에 `RUNWAY_DISPATCH_TOKEN` 연결 |
| `9efc009` · `625fd46` | 9/28 13:17 | 텔레그램 급변 알림 + 루프 설정 (지금 `collect.yml`·`publish.sh`) |
| `fa04ec1` | 9/28 13:24 | 전송 실패 재시도, 단체방 번호 넘기기 |
| `ba8e405` | 9/28 13:48 | 런웨이 텔레그램 알림 끔 (`runway_tick.sh` 아무것도 안 함) |
| `83106c4` | 9/28 13:52 | 코인별 2%/7% |
| `e2f042f` | 9/28 14:04 | **합산 1.7%/5% (지금 알림 로직)** |
| `c220bf3` | 9/28 15:10 | (runway) 최신 `runway/core.js`. 알림의 보유 수량 계산이 이 파일을 씀 |

  - 나머지 `runway/` 커밋은 범위 밖이라 뺐어요.
- **로컬 사본** (git 저장소 아님, 웹 업로드용 작업 폴더): `/Users/jaylee/.aside/u/0/sessions/2026-09-27_4jC2xnQrzokhKbPE/artifacts/repo/`
  - 코인 범위 파일: `index.html`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `collect.mjs`, `forecast.mjs`, `news.mjs`, `price_alert.mjs`, `publish.sh`, `runway_tick.sh`, `.github/workflows/collect.yml`
  - 의존 파일: `runway/core.js`
  - 위 14개가 모두 `main`과 같아요(10/1 23:19 확인). 새 스레드가 이 경로를 읽을 수 없으면 파일 접근을 요청하거나, GitHub `main`을 기준으로 삼으면 돼요(내용이 같아요).
- **같은 세션의 범위 밖 폴더**: `…/artifacts/runway-data/`, `…/artifacts/apps-script/`. 개인 금융 기록이 있으니 열지 마세요.
- **임시 파일** (지워질 수 있음): `/Users/jaylee/.aside/u/0/sessions/2026-09-27_4jC2xnQrzokhKbPE/tmp/` (스크린샷, 백테스트용 history 사본)

## 12. 협업 메모

- **단독 소유**: 이 문서 뒤로 코인 시세 추적은 새 스레드 하나만 맡아요. 이전 담당은 파일 수정과 실행을 멈췄어요(§13).
- **다른 작업과의 관계**: 같은 Aside 프로젝트의 다른 작업(MatchOS 인계, HANI 블로그·인스타 인계)과 공유하는 파일이나 저장소는 없어요.
- **Runway(가계 앱)와의 경계**
  - 같은 저장소의 `runway/` 폴더와 같은 텔레그램 봇을 써요.
  - `price_alert.mjs`가 `runway/core.js`를 불러서 `compute(...).hold.SOL`과 `hold.WLD`를 써요. Runway 쪽에서 이 파일을 바꿀 때 이 값의 뜻이 그대로 유지돼야 해요. Runway 담당이 생기면 이 점을 알려 주세요.
  - Runway 기록 내용(금액, 잔액, 메모)은 읽거나 출력하지 마세요.
- **사용자와 이야기할 때**
  - 쉬운 한국어로, 결론과 근거를 먼저 말하고 다음 단계는 하나만 제시해요.
  - 결정이 필요하면 한 번에 하나만 묻고, 추천안을 맨 앞에 "(추천)"으로 붙여요.
  - 확인한 사실과 추측을 나눠요. 다 됐다고 말하기 전에 data 브랜치와 로그로 실제로 확인하고, 가능하면 화면 증거를 붙여요. 사용자는 정확한 숫자와 한계를 원해요.
  - "진행해줘" 같은 짧은 말은 "지금 해 달라"는 뜻으로 써 왔어요. 하지만 지금 권한(가격 추적만)을 넘는 일이면 실행하지 말고 승인 범위부터 확인하세요.
- **텔레그램**: 코인 알림 전용이에요(사용자 결정). Runway 경고는 앱 화면에만 떠요.

## 13. 소유권 넘김 확인

- 이전 담당(세션 `2026-09-27_4jC2xnQrzokhKbPE`)은 2026-10-01 23:19 KST 읽기 점검 뒤 이 문서만 쓰고 멈췄어요.
  - 마지막 저장소 변경은 9/28 15:10:44 `c220bf3`이에요.
  - 이번 인계에서는 저장소, data 브랜치, 워크플로, 비밀값, Pages를 바꾸지 않았고 읽기 점검만 했어요. 예외는 10/2 사용자 지시로 이 문서 하나를 `docs/HANDOVER.md`로 올린 것뿐이에요.
  - 이 스레드가 켜 둔 하위 에이전트나 Aside 루틴은 없어요.
  - 이 스레드에 붙은 브라우저 탭은 남아 있지 않아요(10/1 확인). 작업 중 쓴 비밀값은 메모리에서 지웠어요.
  - 지금 돌고 있는 건 GitHub Actions의 `collect-coinone` 루프뿐이에요. 이 스레드의 프로세스가 아니니, 그대로 새 담당에게 넘겨요.
- 새 담당은 단독 소유자로서 §0 권한 안에서만 움직여요.

## 14. 확인 못 한 것 (인계 시점에 일부러 다시 보지 않음)

사용자가 인계 시점에 추가 점검을 멈추라고 했어요. 그래서 아래 항목은 확인하지 않은 상태 그대로 넘겨요.

1. `runway-check` 워크플로가 지금도 꺼져 있는지. 마지막 확인은 9/28 14:3x예요.
2. 9/28 이후 실제 알림 횟수와, 알림이 단체방에 실제로 도착했는지. 상태 파일로만 판단했어요.
3. 공개 코인 페이지 화면이 지금 제대로 뜨는지. 10/1에는 데이터와 파일만 확인했고 페이지는 열지 않았어요.
4. 9/28 이후 Runway에 매도가 기록됐는지. 기록 내용은 범위 밖이라 보지 않았어요. 기록됐다면 페이지 수량과 알림 수량이 이미 다를 수 있어요(§10-2).
5. 사용자가 봇 토큰을 이미 다시 발급했는지. 10/1 16:27에 전송 성공 상태가 남아 있는 것까지만 알아요.
6. 10/2 03:09경 다음 자동 연결이 실제로 되는지. 예상 시각만 있어요.
7. 꺼진 runway 워크플로로 단체방 번호를 넘길 때(`tellRunway`) 실제로 어떤 HTTP 상태가 나오는지.
8. GitHub Actions 약관을 어떻게 해석해야 하는지, 60일 규칙에서 data 브랜치 푸시가 "활동"으로 쳐지는지(§10-4, §10-5).
9. §7-9 명령(job 단계 조회)은 이번에 돌리지 않았어요.

- **막힌 도구**: 이번 인계 중 멈추거나 거절된 도구는 없었어요. 브라우저 확인은 이 세션에 붙은 탭이 없어서 하지 않았고, 새 탭은 일부러 열지 않았어요.
- **다른 스레드**: HANI 담당 스레드가 코인 작업에는 관여하지 않겠다고 알려 왔어요(10/1). HANI 인계서는 따로 있어요: `/Users/jaylee/Downloads/hani-telegram-ops/docs/HANDOVER.md`
