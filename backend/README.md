# KHU 블록체인 프로젝트 — 백엔드 (v2.0)

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
| 체인 연동 | [ethers v6](https://docs.ethers.org/v6/) |
| API 서버 | [Express](https://expressjs.com/) + [cors](https://github.com/expressjs/cors) |
| 데이터베이스 | PostgreSQL (드라이버: [pg](https://node-postgres.com/)) |
| 환경변수 | [dotenv](https://github.com/motdotla/dotenv) |
| 난수원 | Chainlink VRF v2 |

## 폴더 구조

```
backend/
├── indexer/            # 온체인 이벤트 인덱서 (체인 → DB 동기화)
│   └── indexer.js      #   3개 이벤트 핸들러 + 폴링 루프
├── api/                # REST API 서버 (DB → 클라이언트)
│   └── server.js       #   /api/stats, /api/attempts, /api/probability
├── db/                 # PostgreSQL 스키마 및 쿼리 모음
│   └── schema.sql      #   4개 테이블 (attempts, user_items,
│                       #              probability_history, indexer_cursor)
├── docs/               # 문서
│   ├── events.md       #   ★ 컨트랙트 팀과 합의된 3개 이벤트 최종 명세 (v2)
│   └── design_decisions.md  # ★ 시니어 설계 결정 기록
├── .env.example        # 환경변수 템플릿
├── .gitignore
└── package.json
```

## 차별화 포인트 — 우리만 한다 (★ 발표 핵심)

### 1. 통계 검정 기반 확률 정직성 검증

단순히 시도/성공 횟수를 보여주는 데 그치지 않고:

- **Wilson 95% 신뢰구간** — 표본 크기를 반영한 실측 성공률 구간 추정.
- **카이제곱 검정 (1자유도)** — "표기 확률(`successRate`)과 실측 결과가 통계적으로 유의미하게 다른가?" 를 p-value 로 정량화.
- 결과를 `plausible / suspicious / insufficient_data` 3단계 라벨로 사용자에게 직관적으로 전달.

→ 사용자는 "체감상 확률이 낮다"는 주관적 의심을 객관적 지표로 확인할 수 있다.

→ 엔드포인트: `GET /api/stats/by-level`, `GET /api/stats/global`, `GET /api/stats/user/:address`

### 2. VRF 재검증 (Off-chain Re-derivation)

`EnhancementCompleted.randomValue` 와 `EnhancementCompleted.successRate` 를 가지고 컨트랙트의 결과 산출 로직(`(randomValue % 10000) < successRate`)을 백엔드에서 그대로 재현하여 시도 1건 단위로 검증한다. 컨트랙트가 난수를 받고도 다른 결과를 기록했다면 즉시 탐지된다.

→ 엔드포인트: `GET /api/attempts/:attemptId`

### 3. 확률표 변경 추적 (`ProbabilityTableUpdated` 이벤트)

`probability_history` 테이블로 **언제, 어느 단계의 확률을, 얼마에서 얼마로 바꿨는지**를 영구 기록한다. 운영사의 사일런트 너프(silent nerf) 행위를 차단하고, 모든 확률 변경에 영구 감사 기록을 남긴다.

→ 엔드포인트: `GET /api/probability/history?level=<n>`

## 처리하는 이벤트 (총 3개 — V2 단순화)

자세한 시그니처와 자료형 근거는 [docs/events.md](docs/events.md), 통합 결정 근거는 [docs/design_decisions.md](docs/design_decisions.md) 참고.

| # | 이벤트 | 의미 | DB 매핑 |
| --- | --- | --- | --- |
| 1 | `EnhancementRequested` | 강화 요청 + VRF 송신 (V1의 2개 이벤트 통합) | `attempts` INSERT |
| 2 | `EnhancementCompleted` | 강화 결과 + VRF 응답 (V1의 2개 이벤트 통합) | `attempts` UPDATE + `user_items` UPSERT (★ 한 트랜잭션) |
| 3 | `ProbabilityTableUpdated` ★ | 확률표 변경 (관리자) | `probability_history` INSERT |

> ★ **`user_items` 는 별도 이벤트 없이 백엔드가 자동 갱신한다.**
> `EnhancementCompleted` 핸들러가 `attempts` UPDATE 와 같은 DB 트랜잭션 안에서 `user_items` UPSERT 를 함께 수행한다.

## 실행 방법

> ⚠️ 현재는 골격(placeholder) 단계이며, 본격 구현은 발표 이후 진행 예정.

```bash
# 1) 의존성 설치
npm install

# 2) 환경변수 설정
cp .env.example .env
# .env 파일을 열어 RPC_URL, CONTRACT_ADDRESS, DATABASE_URL 채우기

# 3) DB 스키마 적용
psql "$DATABASE_URL" -f db/schema.sql

# 4) 인덱서 실행 (별도 터미널)
npm run indexer

# 5) API 서버 실행
npm start
```

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

V1의 사고는 "온체인 이벤트마다 DB 테이블이 1:1로 매핑된다"였다.
하지만 잘 보면 **이벤트와 테이블의 비용 주체가 다르다**.

- **이벤트**는 컨트랙트의 비용이고, 결국 **사용자의 가스**다.
- **테이블**은 백엔드의 비용이고, **운영자 인프라 부담**이다.

비용 주체가 다르면 결정도 따로 해야 한다.
그렇다면 "사용자 가스를 더 받지 않고도, 운영자가 백엔드에서 같은 정보를 얻을 수 있는가?" 를 물어야 한다.

`UserItemStateUpdated` 가 정확히 이 질문에 걸린다.
이 이벤트의 모든 정보(`level`, `totalAttempts`)는 `EnhancementCompleted.afterLevel` 과 시도 카운트로 100% 추론 가능하다. 우리 시스템에 강화 외 아이템 상태 변경 경로가 없기 때문이다.

→ 컨트랙트는 emit하지 않는다 (가스 절감)
→ 백엔드 인덱서가 `EnhancementCompleted` 처리 시 `user_items` 를 자동 UPSERT
→ DB 트랜잭션으로 `attempts` UPDATE 와 함께 묶어 무결성 강화

이로써 **사용자 가스 비용은 줄어들고, 운영자의 데이터 무결성은 강해진다.**
같은 시스템에서 양쪽 모두 더 좋아진다 — 이게 V2 단순화의 핵심.

자세한 결정 기록은 [docs/design_decisions.md](docs/design_decisions.md) 참고.

### 본구현 단계 합의 사항

V2 명세 적용에는 **컨트랙트 변경**이 따른다. 컨트랙트 팀(이주안)과 다음 사항을 본구현 직전에 합의해야 한다.

- 6개 이벤트 → 3개 이벤트로 컨트랙트 코드 변경 (`EnhancementRequested`/`EnhancementCompleted` 신설, 4개 이벤트 제거).
- `UserItemStateUpdated` emit 제거 — 백엔드가 자동 갱신함을 명시.
- 가스 측정으로 13% 절감 추정치 검증.
- ABI 산출물(`artifacts/Enhancement.json`) 백엔드에 공유.

## 관련 문서

- [docs/events.md](docs/events.md) — 컨트랙트 팀과 합의된 3개 이벤트 최종 명세 (v2.0)
- [docs/design_decisions.md](docs/design_decisions.md) — 시니어 설계 결정 기록
- [db/schema.sql](db/schema.sql) — DB 스키마 + 자료형 매핑 근거
