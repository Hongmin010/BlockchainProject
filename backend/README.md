# KHU 블록체인 프로젝트 — 백엔드 (v4.0)

> **게임 확률 검증 백엔드** — 블록체인에 기록된 강화(Enhancement) 이벤트를 인덱싱하여, 게임사가 광고한 확률과 실제 결과가 일치하는지 통계적으로 검증하고, Chainlink VRF 난수가 결과 산출에 정직하게 사용되었는지 재검증하며, 운영사의 확률표 변경 이력을 영구 보존한다. v4 부터는 **고급강화(Safe/Risky/파괴/보장)** 와 **업적 NFT 조회**까지 다룬다 (컨트랙트 2개 인덱싱 + 1개 즉석 조회).

> 🌐 **라이브 API**: `https://khu-blockchain-api.onrender.com` · 엔드포인트 상세 명세는 [docs/api.md](docs/api.md)

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
| 기본 강화 | `EnhancementGameVRF` — `0x73e8bbe5ea755376ddd30ea1a2df3dae5d289a59` (Merkle 버전, **인덱싱**) |
| 고급강화 | `AdvancedEnhancementGameVRF` — `0x4f1c8573446efc5ae48eb453cfc66fafe26c2f5c` (base 를 참조하는 별도 컨트랙트, **인덱싱**) |
| 업적 NFT | `EnhancementAchievements` — `0xc65089C74f1A315962BE5e172255b568a29F491c` (**즉석 조회만** — 인덱싱 안 함) |
| VRF Coordinator | `0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE` (v2.5) |
| ABI | `abi/EnhancementGameVRF.json` · `abi/AdvancedEnhancementGameVRF.json` (배포본 산출물) |

## 폴더 구조

```
backend/
├── indexer/            # 온체인 이벤트 인덱서 (체인 → DB 동기화)
│   └── indexer.js      #   2개 컨트랙트 · 6개 이벤트 핸들러 + 폴링 루프 (ABI 기반)
├── api/                # REST API 서버 (DB → 클라이언트)
│   └── server.js       #   19개 라우트 (/health + /api/*)
├── db/                 # PostgreSQL 스키마 + 연결 풀
│   ├── schema.sql      #   6개 테이블 (v4 — 고급강화 반영)
│   └── pool.js         #   lazy 싱글턴 풀 + withTransaction 헬퍼 (SSL 자동 분기)
├── utils/              # 순수 함수 모음 (단위 테스트 대상, 99개)
│   ├── stats.js        #   Wilson CI · 카이제곱(1df/다항) · fairnessVerdict
│   ├── verify.js       #   VRF off-chain 재검증 · 주소 정규화
│   ├── advancedVerify.js    # 고급강화 결과 재검증 (컨트랙트 산출 로직 재현)
│   ├── advancedStats.js     # 고급강화 통계 (Safe 이항 / Risky 3분 다항)
│   ├── achievements.js      # 업적 NFT 조회 클라이언트 (RPC read-on-demand)
│   └── merkle.js       #   Merkle proof 발급 (allowlist 트리 재구성)
├── abi/                # 배포본 ABI
│   ├── EnhancementGameVRF.json
│   └── AdvancedEnhancementGameVRF.json
├── merkle/             # allowlist (Merkle proof 발급용)
│   ├── allowlist.json  #   등록 목록 (컨트랙트팀 claims 파일 기준, 온체인 root 자가검증)
│   └── merkle-claims.baseSepolia.json  # 컨트랙트팀 원본 claims (201건, proof 포함)
├── docs/               # 문서
│   ├── api.md          #   ★ 전체 API 명세 (프론트 연동용 — 요청/응답 예시)
│   ├── events.md       #   컨트랙트 팀과 합의된 이벤트 명세 (v3)
│   └── design_decisions.md  # 설계 결정 기록
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
- **다항 카이제곱 검정 (2자유도)** — 고급강화 Risky 모드의 성공/파괴/유지 3분 결과를 동시 검정. **표기 파괴율**(게임사가 가장 의심받는 확률)을 직접 검증한다. 보장강화(Guaranteed)는 확률 사건이 아니므로 표본에서 제외.
- 결과를 `plausible / suspicious / insufficient_data` 3단계 라벨로 사용자에게 직관적으로 전달.

→ 사용자는 "체감상 확률이 낮다"는 주관적 의심을 객관적 지표로 확인할 수 있다.

→ 엔드포인트: `GET /api/stats/by-level`, `GET /api/stats/global`, `GET /api/stats/user/:address`, `GET /api/advanced/stats`

### 2. VRF 재검증 (Off-chain Re-derivation)

`EnhancementCompleted.randomValue` 와 `successRate` 를 가지고 컨트랙트의 결과 산출 로직(`(randomValue % 10000) < successRate`)을 백엔드에서 그대로 재현하여 시도 1건 단위로 검증한다. 컨트랙트가 난수를 받고도 다른 결과를 기록했다면 즉시 탐지된다.

고급강화는 결과가 5종(유지/성공/하락/파괴/보장)이라 재검증도 확장됐다 — roll 비교뿐 아니라 **레벨·스트릭 전이, 보장강화 발동 조건, 모드별 확률 유효성까지 8개 체크**로 대조한다 (`utils/advancedVerify.js`).

→ 엔드포인트: `GET /api/attempts/:attemptId`, `GET /api/advanced/attempts/:attemptId`, `GET /api/attempts/by-tx/:txHash` (tx 해시로 양쪽 통합 조회)

### 3. 확률표 변경 추적 (`ProbabilityTableUpdated` 이벤트)

`probability_history` 테이블로 **언제, 어느 단계의 확률을, 얼마에서 얼마로 바꿨는지**를 영구 기록한다. 운영사의 사일런트 너프(silent nerf)를 차단하고 모든 변경에 감사 기록을 남긴다.

→ 엔드포인트: `GET /api/probability/history?level=<n>`, `GET /api/advanced/rates/history` (고급강화판)

## Merkle allowlist proof 발급 (강화 게이트 대응)

차별화 포인트는 아니지만, 배포본의 `merkleRoot` 게이트 때문에 프론트 강화 요청에 필수다.
등록된 `(user, itemId, enhancementType)` 조합만 `requestEnhancementWithProof(itemId, type, proof)` 로
강화할 수 있고, 이 proof 를 백엔드가 발급한다.

- **leaf** = `keccak256(abi.encode(user, itemId, type))` — 컨트랙트 `getEnhancementLeaf` 와 동일
- **트리** = OZ 표준 정렬-쌍 keccak256, 홀수 노드 promote — 컨트랙트 `MerkleProof.sol` 과 100% 호환
- **등록 목록**은 `merkle/allowlist.json` 에 보관 — **컨트랙트팀의 트리 생성 원본**(`merkle/merkle-claims.baseSepolia.json`, 201건)에서 생성했다. leaf 순서는 claims 배열 순서(컨트랙트 트리 생성 순서)이며, 계산한 root 가 온체인 `merkleRoot` 와 일치함을 모듈 로드 시 자가검증한다(불일치 시 부팅 경고).
- 발급한 proof 는 온체인 `isValidEnhancementProof` 로 검증 완료 (컨트랙트팀 proof 와 201/201 동일 확인).

→ 엔드포인트: `GET /api/merkle/proof?user=<addr>&itemId=<n>&type=<n>` (미등록 조합은 404)

## 처리하는 이벤트 (컨트랙트 3개 · 총 8개)

자세한 시그니처와 자료형 근거는 [docs/events.md](docs/events.md), 통합 결정 근거는 [docs/design_decisions.md](docs/design_decisions.md) 참고.

| # | 컨트랙트 | 이벤트 | 의미 | DB 매핑 |
| --- | --- | --- | --- | --- |
| 1 | 기본 | `EnhancementRequested` | 강화 요청 + VRF 송신 | `attempts` INSERT |
| 2 | 기본 | `EnhancementCompleted` | 강화 결과 + VRF 응답 | `attempts` UPDATE + `user_items` UPSERT (★ 한 트랜잭션) |
| 3 | 기본 | `ProbabilityTableUpdated` ★ | 확률표 변경 (관리자) | `probability_history` INSERT |
| 4 | 고급 | `AdvancedEnhancementRequested` | 고급강화 요청 | `advanced_attempts` UPSERT (pending) |
| 5 | 고급 | `AdvancedEnhancementResult` | 고급강화 결과 (5종) | `advanced_attempts` UPSERT + `user_items` 갱신 (★ 한 트랜잭션) |
| 6 | 고급 | `AdvancedRateUpdated` | 고급강화 확률 변경 | `advanced_rate_history` INSERT |
| 7 | 업적 | `AchievementMinted` | 오프체인 업적(3·4·5) 백엔드 민트 | `achievements` INSERT (offchain/minted, dataHash) |
| 8 | 업적 | `AchievementClaimed` | 온체인 업적(6~10) 컨트랙트 자체판정 | `achievements` INSERT (onchain/minted, itemId) |

> ★ **`user_items` 는 별도 이벤트 없이 백엔드가 자동 갱신한다.**
> 기본 강화의 `EnhancementCompleted` 와 고급강화의 `AdvancedEnhancementResult` 핸들러가
> 각자 attempts 갱신과 같은 DB 트랜잭션 안에서 `user_items` UPSERT 를 함께 수행한다.
> 업적 이벤트(7·8)는 `ACHIEVEMENTS_NFT_ADDRESS` 설정 시에만 구독한다(미설정이면 자동 제외).
> 구 레지스트리 RPC 조회는 `/api/achievements/legacy/:address` 가 담당(인덱싱 아님).

## 업적 시스템 v5 (배포 컨트랙트 EnhancementAchievements 연동)

배포 컨트랙트(`0x7b5a6404bda67B085aA40aEFbfe72AB9BD28dd4B`, Base Sepolia)의 토큰 ID 체계에 맞춰 백엔드를 연동했다. 실제 민트는 minter 지갑 private key + 토큰 메타데이터 준비 후 `.env` 에 `ACHIEVEMENTS_NFT_ADDRESS`·`RPC_URL`·`PRIVATE_KEY` 추가 + `MOCK_MINT=false` 로 전환한다.

**판정 위치 경계** — ID 3(공식인증 호구)·4(천운)·5(다둥이 집사)는 컨트랙트가 on-chain 으로 못 하는 통계 판정이라 **백엔드가 판정**(`lib/achievementJudge.js`, Wilson 95% CI 재사용) → 근거 payload 의 keccak256 해시를 `mintAchievement(user, tokenId, dataHash)` 로 발급(`AchievementMinted`) → 제3자가 `/proof` API 로 재검증 가능. ID 6~10(최고강화·연속성공·파괴생존·보장·수직낙하)은 **컨트랙트가 `getAchievementStats` 로 자체 판정**(`claim*`/`award*` → `AchievementClaimed`) → 인덱서는 기록만(재판정 금지).

- dataHash 규약: [docs/hash-test-vector.md](docs/hash-test-vector.md) — 컨트랙트는 dataHash 를 검증 없이 박제만 하므로, 이 인코딩은 백엔드↔제3자 재검증용 자체 규약이다(컨트랙트와 바이트 일치 불요).
- 판정 훅: 인덱서 `EnhancementResult` 처리 직후 해당 유저만 검사 (전체 스캔 없음, 표본 30회 미만 운 판정 스킵)
- mint: `MOCK_MINT=true` 면 가짜 tx_hash 로 전 흐름 검증 (minter key 도착 전 기본 운용 모드). 상태 전이 `detected → minting → minted/failed(재시도 가능)`
- 중복 발급 차단: `achievements` 테이블 `UNIQUE(wallet, achievement_id)` + 컨트랙트 `claimed[user][tokenId]`

## API 엔드포인트 요약

base URL — 배포 **`https://khu-blockchain-api.onrender.com`**, 로컬 `http://localhost:3000`. CORS 전체 허용. 모든 응답은 JSON, 에러는 `{ error, message? }` 형태.

> **요청/응답 필드 상세 명세 + 예시는 [docs/api.md](docs/api.md)** — 프론트 연동 시 이 문서를 보면 된다.

| Method · 경로 | 용도 | 프론트 화면 |
| --- | --- | --- |
| `GET /health` | 서버/DB 헬스체크 (콜드스타트 워밍업 겸용) | (운영) |
| `GET /api/stats/global` | 전체 누적 통계 | Dashboard |
| `GET /api/stats/by-level` ★ | 단계별 표기 vs 실측 + 통계 검정 | Dashboard |
| `GET /api/stats/user/:address` | 사용자 시도 통계 + 보유 아이템 | Records |
| `GET /api/attempts/recent` `[?user=<addr>]` | 최근 시도 목록 (user 지정 시 해당 유저만 — "내 기록"용) | Dashboard / Records |
| `GET /api/attempts/:attemptId` ★ | 시도 1건 상세 + VRF 재검증 | Verify |
| `GET /api/attempts/by-tx/:txHash` ★ | 트랜잭션 해시로 시도 조회 + 재검증 (기본/고급 통합, `type` 필드로 구분) | Verify |
| `GET /api/probability/history?level=<n>` ★ | 확률표 변경 이력 | Dashboard |
| `GET /api/merkle/proof?user=<addr>&itemId=<n>&type=<n>` | allowlist Merkle proof 발급 (강화 요청용) | Game (강화) |
| `GET /api/merkle/items/:address` | 주소별 등록 itemId 목록 (강화 가능 아이템) | Game (아이템 선택) |
| `GET /api/advanced/attempts/recent` `[?user=<addr>]` | 고급강화 최근 시도 목록 | Dashboard / Records |
| `GET /api/advanced/attempts/:attemptId` ★ | 고급강화 1건 상세 + 결과 재검증 (8개 체크) | Verify |
| `GET /api/advanced/stats` ★ | 고급강화 모드·단계별 통계 검정 (파괴율 포함) | Dashboard |
| `GET /api/advanced/rates/history` `[?mode=<0\|1>&extraLevel=<n>]` ★ | 고급강화 확률표 변경 이력 | Dashboard |
| `GET /api/ranking?limit=<n>` | 랭킹 3종 (최고 아이템 / 도전왕 / 성공왕) | Ranking |
| `GET /api/achievements/holders` | 업적 NFT 보유자 목록 (구 컨트랙트, 온체인 즉석 조회) | Ranking |
| `GET /api/achievements/:wallet` ★ | 온/오프체인 통합 업적 목록 (v5 신규 시스템, ID 3~10) | Records / 업적 |
| `GET /api/achievements/:wallet/:achievementId/proof` ★ | 오프체인 업적 판정 근거 공개 (payload + dataHash, 제3자 재검증) | Verify / 업적 |
| `GET /api/achievements/legacy/:address` `[?itemId=<n>]` | (deprecated) 구 컨트랙트 발급 여부 + 클레임 가능 여부 | Records / Game |

> **프론트엔드 안내:** 프론트는 Supabase 에 직접 접근하지 않는다. 위 REST API 만 호출한다(백엔드가 게이트키퍼). 단, **"강화 시도"(Game 페이지)는 백엔드가 아니라 지갑으로 컨트랙트에 직접 트랜잭션을 보내는 동작**이다 — 백엔드는 읽기 전용 검증 + 강화에 필요한 Merkle proof 발급(`/api/merkle/proof`)을 담당한다. (컨트랙트 `merkleRoot` 게이트 때문에 **등록된 `(user, itemId, type)` 만** 강화 가능 — 미등록 지갑/아이템은 proof 가 안 나온다.)

## 실행 방법 (로컬)

```bash
# 1) 의존성 설치
npm install

# 2) 환경변수 설정
cp .env.example .env
# .env 에 RPC_URL, CONTRACT_ADDRESS, ADVANCED_CONTRACT_ADDRESS,
#         ACHIEVEMENT_CONTRACT_ADDRESS, DATABASE_URL 채우기

# 3) DB 스키마 적용
psql "$DATABASE_URL" -f db/schema.sql

# 4) 단위 테스트 (99개 — DB/네트워크 불필요)
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
4. Render 환경변수 입력: `DATABASE_URL`(Transaction Pooler 6543), `RPC_URL`, `CONTRACT_ADDRESS` (`DATABASE_SSL`/`ACHIEVEMENT_CONTRACT_ADDRESS` 는 render.yaml 이 자동 설정)
5. 배포 후 `/health` 가 `{ db: true }` 인지 확인 → 팀에 API URL 공유

> ✅ **2026-06-10 배포 완료**: `https://khu-blockchain-api.onrender.com` — main 브랜치 push 시 자동 재배포(autoDeploy).

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

- [docs/api.md](docs/api.md) — ★ 전체 API 명세 (프론트 연동용 — 요청/응답 예시)
- [docs/events.md](docs/events.md) — 3개 이벤트 명세 (v3) + V2→V3 매핑
- [docs/design_decisions.md](docs/design_decisions.md) — 설계 결정 기록
- [db/schema.sql](db/schema.sql) — DB 스키마 + 자료형 매핑 근거
- [SETUP.md](SETUP.md) — 로컬 환경 구축 가이드
- [../render.yaml](../render.yaml) — Render 배포 Blueprint
