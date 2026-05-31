# KHU 블록체인 프로젝트 — 백엔드 (v3.0)

> **게임 확률 검증 백엔드** — 블록체인에 기록된 강화(Enhancement) 이벤트 3종을 인덱싱하여, 게임사가 광고한 확률과 실제 결과가 일치하는지 통계적으로 검증하고, Chainlink VRF 난수가 결과 산출에 정직하게 사용되었는지 재검증하며, 운영사의 확률표 변경 이력을 영구 보존한다.

## 프로젝트 소개

기존 게임의 "확률형 아이템" 시스템은 운영사가 표기 확률을 임의로 변경하거나, 표기와 다른 확률을 적용해도 사용자가 검증할 방법이 없었다. 본 프로젝트는 강화 라이프사이클의 핵심 단계(시도+VRF요청 → 결과+VRF응답 → 확률표 변경)를 온체인 이벤트로 발행하고, 백엔드가 이를 인덱싱하여 다음을 누구나 검증 가능한 형태로 제공한다.

- 사용자별 강화 시도 내역 조회
- **단계별 실측 성공률과 표기 확률의 통계적 차이 검증** (Wilson 95% CI + 카이제곱 p-value)
- **개별 강화 결과의 VRF 난수 재계산 검증** (off-chain re-derivation)
- **확률표 변경 이력 영구 보존 및 조회**

## 기술 스택

| 계층 | 사용 기술 |
| --- | --- |
| 런타임 | Node.js (CommonJS) |
| 체인 연동 | [ethers v6](https://docs.ethers.org/v6/) — ABI 파일(`abi/EnhancementGameVRF.json`) 기반 `Interface` |
| API 서버 | [Express](https://expressjs.com/) + [cors](https://github.com/expressjs/cors) |
| 데이터베이스 | PostgreSQL (드라이버: [pg](https://node-postgres.com/)) — 로컬 / 클라우드는 **Supabase** |
| 환경변수 | [dotenv](https://github.com/motdotla/dotenv) |
| 난수원 | Chainlink VRF v2.5 (Native payment) |
| 대상 네트워크 | **Base Sepolia** |

## 배포 대상 컨트랙트

| 항목 | 값 |
| --- | --- |
| 네트워크 | Base Sepolia |
| 컨트랙트 | `EnhancementGameVRF` — `0x73e8bbe5ea755376ddd30ea1a2df3dae5d289a59` (Merkle 버전) |
| VRF Coordinator | `0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE` (v2.5) |
| ABI | `abi/EnhancementGameVRF.json` (배포본 산출물) |

## 폴더 구조

```
backend/
├── indexer/            # 온체인 이벤트 인덱서 (체인 → DB 동기화)
│   └── indexer.js      #   3개 이벤트 핸들러 + 폴링 루프 (ABI 기반)
├── api/                # REST API 서버 (DB → 클라이언트)
│   └── server.js       #   7개 라우트 (/health + /api/*)
├── db/                 # PostgreSQL 스키마 + 연결 풀
│   ├── schema.sql      #   4개 테이블 + 11개 인덱스 (v3 정렬)
│   └── pool.js         #   lazy 싱글턴 풀 + withTransaction 헬퍼 (SSL 자동 분기)
├── utils/              # 순수 함수 모음 (단위 테스트 대상)
│   ├── stats.js        #   Wilson CI · 카이제곱 · fairnessVerdict
│   └── verify.js       #   VRF off-chain 재검증 · 주소 정규화
├── abi/                # 배포본 ABI
│   └── EnhancementGameVRF.json
├── docs/               # 문서
│   ├── events.md       #   ★ 컨트랙트 팀과 합의된 3개 이벤트 명세 (v3)
│   └── design_decisions.md  # ★ 설계 결정 기록
├── .env.example        # 환경변수 템플릿 (로컬/클라우드 가이드 포함)
├── SETUP.md            # 로컬 환경 구축 가이드 (Windows 기준)
├── package.json
└── README.md
```

> 클라우드 배포용 `render.yaml` 은 **저장소 루트**에 있다.

## 차별화 포인트 — 우리만 한다 (★ 발표 핵심)

### 1. 통계 검정 기반 확률 정직성 검증

단순히 시도/성공 횟수를 보여주는 데 그치지 않고:

- **Wilson 95% 신뢰구간** — 표본 크기를 반영한 실측 성공률 구간 추정.
- **카이제곱 검정 (1자유도)** — "표기 확률(`successRate`)과 실측 결과가 통계적으로 유의미하게 다른가?" 를 p-value 로 정량화.
- 결과를 `plausible / suspicious / insufficient_data` 3단계 라벨로 사용자에게 직관적으로 전달.

→ 사용자는 "체감상 확률이 낮다"는 주관적 의심을 객관적 지표로 확인할 수 있다.

→ 엔드포인트: `GET /api/stats/by-level`, `GET /api/stats/global`, `GET /api/stats/user/:address`

### 2. VRF 재검증 (Off-chain Re-derivation)

`EnhancementCompleted.randomValue` 와 `successRate` 를 가지고 컨트랙트의 결과 산출 로직(`(randomValue % 10000) < successRate`)을 백엔드에서 그대로 재현하여 시도 1건 단위로 검증한다. 컨트랙트가 난수를 받고도 다른 결과를 기록했다면 즉시 탐지된다.

→ 엔드포인트: `GET /api/attempts/:attemptId`

### 3. 확률표 변경 추적 (`ProbabilityTableUpdated` 이벤트)

`probability_history` 테이블로 **언제, 어느 단계의 확률을, 얼마에서 얼마로 바꿨는지**를 영구 기록한다. 운영사의 사일런트 너프(silent nerf)를 차단하고 모든 변경에 감사 기록을 남긴다.

→ 엔드포인트: `GET /api/probability/history?level=<n>`

## 처리하는 이벤트 (총 3개)

자세한 시그니처와 자료형 근거는 [docs/events.md](docs/events.md), 통합 결정 근거는 [docs/design_decisions.md](docs/design_decisions.md) 참고.

| # | 이벤트 | 의미 | DB 매핑 |
| --- | --- | --- | --- |
| 1 | `EnhancementRequested` | 강화 요청 + VRF 송신 | `attempts` INSERT |
| 2 | `EnhancementCompleted` | 강화 결과 + VRF 응답 | `attempts` UPDATE + `user_items` UPSERT (★ 한 트랜잭션) |
| 3 | `ProbabilityTableUpdated` ★ | 확률표 변경 (관리자) | `probability_history` INSERT |

> ★ **`user_items` 는 별도 이벤트 없이 백엔드가 자동 갱신한다.**
> `EnhancementCompleted` 핸들러가 `attempts` UPDATE 와 같은 DB 트랜잭션 안에서 `user_items` UPSERT 를 함께 수행한다.

## API 엔드포인트 요약

base URL — 로컬 `http://localhost:3000`, 클라우드 `https://<render-service>.onrender.com`. CORS 전체 허용. 모든 응답은 JSON, 에러는 `{ error, message? }` 형태.

| Method · 경로 | 용도 | 프론트 화면 |
| --- | --- | --- |
| `GET /health` | 서버/DB 헬스체크 | (운영) |
| `GET /api/stats/global` | 전체 누적 통계 | Dashboard |
| `GET /api/stats/by-level` ★ | 단계별 표기 vs 실측 + 통계 검정 | Dashboard |
| `GET /api/stats/user/:address` | 사용자 시도 통계 + 보유 아이템 | Records |
| `GET /api/attempts/recent` | 최근 시도 목록 | Dashboard / Records |
| `GET /api/attempts/:attemptId` ★ | 시도 1건 상세 + VRF 재검증 | Verify |
| `GET /api/probability/history?level=<n>` ★ | 확률표 변경 이력 | Dashboard |

> **프론트엔드 안내:** 프론트는 Supabase 에 직접 접근하지 않는다. 위 REST API 만 호출한다(백엔드가 게이트키퍼). 단, **"강화 시도"(Game 페이지)는 백엔드가 아니라 지갑으로 컨트랙트에 직접 트랜잭션을 보내는 동작**이다 — 백엔드는 읽기 전용 검증만 담당한다.

## 실행 방법 (로컬)

```bash
# 1) 의존성 설치
npm install

# 2) 환경변수 설정
cp .env.example .env
# .env 에 RPC_URL, CONTRACT_ADDRESS, DATABASE_URL 채우기

# 3) DB 스키마 적용
psql "$DATABASE_URL" -f db/schema.sql

# 4) 단위 테스트 (42개 — DB 불필요)
npm test

# 5) 인덱서 실행 (별도 터미널)
npm run indexer

# 6) API 서버 실행
npm start          # → http://localhost:3000
```

로컬 환경을 처음부터 구축하려면 [SETUP.md](SETUP.md) 참고.

## 클라우드 배포 (Supabase + Render)

발표 데모의 안정성과 "내 노트북에서 다 돌리는 부담" 해소를 위해 클라우드 배포로 전환했다. **전통적 3-tier 게이트키퍼 패턴**이다.

```
프론트엔드 → Render (Express REST API) → Supabase (PostgreSQL)
                                            ▲
                                  로컬 인덱서가 채워 넣음
```

### 컴포넌트

| 컴포넌트 | 서비스 | 비고 |
| --- | --- | --- |
| DB | **Supabase** (서울 리전) | 순수 PostgreSQL 로만 사용 (supabase-js ✕, `pg` 직결) |
| API | **Render** Web Service (free) | `process.env.PORT` 자동 주입, 15분 무요청 시 sleep |
| 인덱서 | **로컬** (당분간) | 발표 직전 Render Background Worker 로 이전 검토 |

### Supabase 보안 설정 — 모두 OFF (의도된 결정)

| 옵션 | 설정 | 이유 |
| --- | --- | --- |
| Enable Data API | ❌ OFF | supabase-js 미사용. `pg` 드라이버로 직접 TCP 접근 |
| Auto-expose tables | ❌ OFF | Data API 안 쓰므로 무의미 |
| Automatic RLS | ❌ OFF | 백엔드 단독 접근 — 행 단위 권한 불필요, 보안은 DATABASE_URL 시크릿으로 충분 |

### 연결 문자열(Connection String) 선택 — ⚠️ 중요

Supabase 무료 tier 의 **Direct 연결(`db.<ref>.supabase.co:5432`)은 IPv6 전용**이라 IPv4 망에선 연결되지 않을 수 있다. 따라서:

| 용도 | 연결 | 포트 | 이유 |
| --- | --- | --- | --- |
| 로컬 인덱서 / psql | **Session Pooler** | 5432 (IPv4) | 인덱서는 `withTransaction`(BEGIN/COMMIT) 사용 → **session 모드 필수** |
| Render API | **Transaction Pooler** | 6543 | API 는 단일 쿼리뿐이라 transaction 모드로 충분 |

> `db/pool.js` 는 연결 문자열에 `supabase.com` 또는 `sslmode=require` 가 있으면 **SSL 을 자동 적용**한다(`DATABASE_SSL=true/false` 로 오버라이드). Supabase 는 TLS 가 강제이므로 이 분기가 없으면 `self-signed certificate in certificate chain` 으로 연결이 실패한다.

### 배포 절차 (요약)

1. Supabase 프로젝트 생성(서울) → 보안 3옵션 OFF
2. Session Pooler URL 로 `db/schema.sql` 적용 → 테이블 4개 확인
3. 저장소 루트 `render.yaml` 로 Render Blueprint 생성
4. Render 환경변수 입력: `DATABASE_URL`(Transaction Pooler 6543), `RPC_URL`, `CONTRACT_ADDRESS`, `DATABASE_SSL=true`
5. 배포 후 `/health` 가 `{ db: true }` 인지 확인 → 팀에 API URL 공유

### 발표 당일 주의 — 콜드스타트 / 일시정지

- Render free 는 15분 무요청 시 sleep → 첫 요청 30~50초.
- Supabase free 는 7일 비활성 시 프로젝트 일시정지.
- → **발표 직전 `/health` 호출로 둘 다 워밍업**하고, 리허설은 콜드 상태에서 1회 실행해 볼 것.
- 폴백: 클라우드 장애 시 로컬 + `cloudflared`/`ngrok` 터널로 즉석 공개(사전 1회 연습 권장).

### 데모 전략 — 하이브리드 (B 기반 + A 피날레)

- **본체(B):** 미리 채운 데이터로 통계 검정·확률표 이력·VRF 재검증을 안정적으로 시연.
- **피날레(A):** 발표 시작 시 강화 tx 를 미리 1회 전송 → 다른 설명으로 시간을 채우는 동안 VRF 콜백 + 인덱싱 진행 → 마지막에 "방금 한 강화가 이미 검증됐다"로 회수. (VRF 콜백 지연이 비결정적이므로 라이브 단독은 위험 — 백업 영상 준비.)

---

## 설계 회고 — V1 → V2 단순화

### 무엇을 바꿨나

| 항목 | V1 | V2 | 이유 |
| --- | --- | --- | --- |
| 이벤트 수 | 6개 | 3개 | 라이프사이클 단계 통합, 추론 가능한 이벤트 제거 |
| 테이블 수 | 5개 | 4개 | `vrf_requests` 를 `attempts` 에 흡수 |
| 가스 비용 | (기준선) | **약 13% 절감** | 이벤트 emit 4회 → 2회로 축소 |
| 책임 분리 | 이벤트 1:1 매핑 | **이벤트 vs 테이블 분리** | "이벤트=사용자 비용, 테이블=운영자 비용" 사고 |

### 핵심 메시지: 이벤트 vs 테이블 책임 분리

V1의 사고는 "온체인 이벤트마다 DB 테이블이 1:1로 매핑된다"였다. 하지만 **이벤트와 테이블의 비용 주체가 다르다**.

- **이벤트**는 컨트랙트의 비용이고, 결국 **사용자의 가스**다.
- **테이블**은 백엔드의 비용이고, **운영자 인프라 부담**이다.

비용 주체가 다르면 결정도 따로 해야 한다. "사용자 가스를 더 받지 않고도 운영자가 백엔드에서 같은 정보를 얻을 수 있는가?"

`UserItemStateUpdated` 가 정확히 이 질문에 걸린다. 이 이벤트의 모든 정보(`level`, `totalAttempts`)는 `EnhancementCompleted.afterLevel` 과 시도 카운트로 100% 추론 가능하다.

→ 컨트랙트는 emit하지 않는다 (가스 절감)
→ 백엔드 인덱서가 `EnhancementCompleted` 처리 시 `user_items` 를 자동 UPSERT
→ DB 트랜잭션으로 `attempts` UPDATE 와 함께 묶어 무결성 강화

**사용자 가스 비용은 줄고, 운영자의 데이터 무결성은 강해진다.** 같은 시스템에서 양쪽 모두 더 좋아진다 — 이게 V2 단순화의 핵심.

### V2 → V3 정렬 (배포본 일치화)

홍민 배포본 `EnhancementGameVRF` 와 일치시키기 위한 조정:

- 컬럼: `randomness_request_id`(bytes32) → **`vrf_request_id`**(NUMERIC uint256), 응답 필드 `vrfRequestId`.
- `before_level` / `claimed_success_rate` NULL 허용 (Requested 이벤트가 두 값을 emit 하지 않음 — Completed 도착 시 채움).
- `attempts.enhancement_type` 컬럼 제거(어느 이벤트에도 없음).
- 멱등성: `(tx_hash, log_index)` UNIQUE 대신 **`attempt_id` PK 기반 UPSERT + `status='pending'` 가드** (도착 순서 무관). `probability_history` 는 `(tx_hash, log_index)` UNIQUE 유지.
- 인덱서가 ABI 파일(`abi/EnhancementGameVRF.json`) 기반 `ethers.Interface` 로 이벤트 파싱.

## 관련 문서

- [docs/events.md](docs/events.md) — 3개 이벤트 명세 (v3) + V2→V3 매핑
- [docs/design_decisions.md](docs/design_decisions.md) — 설계 결정 기록
- [db/schema.sql](db/schema.sql) — DB 스키마 + 자료형 매핑 근거
- [SETUP.md](SETUP.md) — 로컬 환경 구축 가이드
- [../render.yaml](../render.yaml) — Render 배포 Blueprint
