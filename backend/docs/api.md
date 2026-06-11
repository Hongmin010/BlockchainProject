# API 레퍼런스 (v4.0)

프론트엔드 연동용 전체 엔드포인트 명세. 표 요약은 [../README.md](../README.md) 참고.

## 공통 규약

- **Base URL**: 배포 `https://khu-blockchain-api.onrender.com` · 로컬 `http://localhost:3000`
- 모든 응답은 JSON. 에러는 `{ "error": "<코드>", "message"?: "<설명>" }` 형태.
- CORS 전체 허용 — 브라우저에서 바로 fetch 가능.
- **확률 단위는 bp(basis point)**: `0~10000` = `0~100%`. 필드명에 `Bp`/`RateBp` 접미사.
- 주소는 응답에서 **lowercase 로 정규화**되어 나간다. 요청 입력은 대소문자 무관(`0x` + 40 hex).
- `attemptId`, `itemId`, `randomValue`, `vrfRequestId` 등 uint256 계열은 정밀도 보존을 위해 **문자열**로 내려간다.
- ⚠️ **콜드스타트**: Render free 는 15분 무요청 시 sleep — 첫 요청이 30~50초 걸릴 수 있다. 화면 진입 전 `/health` 를 한 번 호출해 깨우는 것을 권장.

### 공통 enum / 라벨

| 값 | 의미 |
| --- | --- |
| `fairnessVerdict` | `plausible`(정상 범위) / `suspicious`(p < 0.01) / `insufficient_data`(표본 < 30) |
| 고급강화 `mode` | `0` = Safe(`modeLabel: "safe"`) / `1` = Risky(`"risky"`) |
| 고급강화 `resultType` | `0` FailKeep(유지) / `1` Success(성공) / `2` SafeDowngrade(하락) / `3` Destroyed(파괴) / `4` Guaranteed(보장강화) — `resultLabel` 로 문자열 제공 |
| `status` | `pending`(VRF 응답 대기) / `completed`(결과 확정) |

---

## 헬스체크

### `GET /health`

서버 + DB 동시 점검. DB 가 죽으면 503.

```json
{ "status": "ok", "service": "khu-blockchain-backend", "version": "4.0", "db": true, "timestamp": "2026-06-10T10:18:21.351Z" }
```

---

## 기본 강화 — 통계 (차별화 #1)

### `GET /api/stats/by-level` ★

단계별 표기 확률 vs 실측 성공률 + 통계 검정. **Dashboard 메인.**

```json
{
  "levels": [
    {
      "beforeLevel": 0,
      "declaredRateBp": 9000,
      "observedSuccess": 101,
      "observedTotal": 115,
      "observedRateBp": 8783,
      "wilson95": { "lowBp": 8060, "highBp": 9261 },
      "chiSquare": { "stat": 0.6038, "pValue": 0.4371 },
      "fairnessVerdict": "plausible"
    }
  ]
}
```

### `GET /api/stats/global`

전체 누적 통계 (Dashboard 상단 카드). **최상위 숫자는 base + 고급강화 합산**이고, `base`/`advanced` 로 내역이 분리되어 있다.

```json
{
  "completedAttempts": 1787,
  "successes": 543,
  "observedRateBp": 3038,
  "uniqueUsers": 3,
  "avgVrfLatencySec": 9.91,
  "base":     { "completedAttempts": 1677, "successes": 501, "observedRateBp": 2988 },
  "advanced": { "completedAttempts": 110,  "successes": 42,  "observedRateBp": 3818 }
}
```

- 고급강화 성공 = `resultType` Success(1) 또는 Guaranteed(4) — 레벨이 오른 시도
- `avgVrfLatencySec` 은 보장강화(VRF 미사용) 표본을 제외한 가중 평균

### `GET /api/stats/user/:address`

사용자별 시도 통계 + 보유 아이템 (Records 페이지). 최상위 숫자는 base + 고급강화 합산 (`base`/`advanced` 내역 포함). 잘못된 주소는 400 `invalid_address`.

```json
{
  "address": "0x9a7f...9aff",
  "completedAttempts": 893,
  "successes": 272,
  "observedRateBp": 3046,
  "base":     { "completedAttempts": 833, "successes": 250, "observedRateBp": 3001 },
  "advanced": { "completedAttempts": 60,  "successes": 22,  "observedRateBp": 3667 },
  "items": [
    { "itemId": "1", "level": 5, "extraLevel": 2, "totalLevel": 7, "totalAttempts": 12, "lastUpdatedAt": "2026-06-01T03:43:56.000Z" }
  ]
}
```

- `items` 의 `extraLevel`(고급강화 단계) / `totalLevel`(= 5 + extraLevel, base 미만렙이면 level 과 동일 기준) 필드 추가

---

## 기본 강화 — 시도 조회 + VRF 재검증 (차별화 #2)

### `GET /api/attempts/recent?limit=20&user=0x...`

최근 시도 목록. `limit` 1~100(기본 20), `user` 지정 시 해당 유저만("내 기록"). 잘못된 `user` 는 400.

```json
{
  "limit": 20,
  "user": null,
  "attempts": [
    {
      "attemptId": "1668", "userAddress": "0x9a7f...9aff", "itemId": "100",
      "beforeLevel": 4, "afterLevel": 5, "claimedSuccessRateBp": 1000, "success": true,
      "vrfRequestId": "78999...62721", "randomValue": "11969...70153",
      "status": "completed",
      "requestedAt": "2026-06-01T03:43:46.000Z", "completedAt": "2026-06-01T03:43:56.000Z",
      "requestedTxHash": "0xaa0a...ed85", "completedTxHash": "0x..."
    }
  ]
}
```

### `GET /api/attempts/:attemptId` ★

시도 1건 상세 + **VRF 재검증** (Verify 페이지). 없는 ID 는 404 `attempt_not_found`.

```json
{
  "attempt": { "...": "attempts/recent 의 1건과 동일 형태" },
  "verification": {
    "successDerived": true,
    "matchesContract": true,
    "formula": "(randomValue % 10000) < claimedSuccessRate"
  }
}
```

`verification` 은 `status='completed'` 일 때만 객체, 아니면 `null`. `matchesContract: false` 면 컨트랙트가 난수와 다른 결과를 기록했다는 뜻(조작 탐지).

---

## 확률표 변경 이력 (차별화 #3)

### `GET /api/probability/history?level=7`

`level`(0~255, 선택) 필터. 최신 → 과거 순.

```json
{
  "level": null,
  "history": [
    { "level": 7, "oldSuccessRateBp": 3000, "newSuccessRateBp": 1000, "onChainTimestamp": "...", "txHash": "0x...", "logIndex": 2, "blockNumber": 42222951 }
  ]
}
```

---

## Merkle proof 발급 (Game 강화 요청용)

### `GET /api/merkle/proof?user=0x...&itemId=1&type=0`

컨트랙트 `merkleRoot` 게이트 때문에 **등록된 (user, itemId, type) 조합만 강화 가능**하다. 프론트는 강화 tx 전에 이 proof 를 받아 `requestEnhancementWithProof(itemId, type, proof)` 에 넣는다.

- 200: `{ user, itemId, type, registered: true, leaf, proof: ["0x..", ...], root }`
- 404 `not_registered`: allowlist 에 없는 조합 — 강화 불가 (proof 없음)
- 400 `invalid_address` / `missing_itemId` / `invalid_itemId` / `invalid_type`

### `GET /api/merkle/items/:address`

특정 주소가 allowlist 에 등록한 **itemId 전체 목록** — 아이템 선택 UI 용.
이 목록에서 아이템을 고른 뒤, 강화 직전에 `/api/merkle/proof` 로 해당 아이템의 proof 를 발급받는 흐름.

```json
{
  "user": "0x9a7f...9aff",
  "type": 0,
  "root": "0xe14e...1e8e",
  "count": 100,
  "itemIds": ["1", "2", "3", "...", "100"]
}
```

- itemId 는 숫자 오름차순 정렬, 문자열 (uint256 규약)
- 미등록 주소는 404 가 아니라 **200 + `count: 0` + 빈 배열** (프론트 분기 단순화)
- 400 `invalid_address`

---

## 고급강화 (Advanced) — base +5 이후 extra 강화

> totalLevel = 5(base) + extraLevel(0~5), 최대 10. Safe(하락 위험)/Risky(파괴 위험) 2모드,
> Safe 2연속 하락 시 다음 Safe 는 보장강화(Guaranteed, VRF 없이 확정 성공).

### `GET /api/advanced/attempts/recent?limit=20&user=0x...`

기본 강화의 `attempts/recent` 와 동일 패턴. 응답 필드:

```json
{
  "limit": 20,
  "user": null,
  "attempts": [
    {
      "attemptId": "3", "userAddress": "0x9a7f...9aff", "itemId": "7",
      "mode": 1, "modeLabel": "risky",
      "beforeExtraLevel": 2, "afterExtraLevel": 0, "beforeTotalLevel": 7, "afterTotalLevel": 5,
      "resultType": 3, "resultLabel": "Destroyed",
      "beforeSafeDropStreak": 0, "afterSafeDropStreak": 0, "guaranteed": false,
      "successRateBp": 3500, "destroyRateBp": 1500,
      "randomValue": "8412...", "rollBp": 4321, "vrfRequestId": "915...",
      "status": "completed",
      "requestedAt": "...", "completedAt": "...", "requestedTxHash": "0x...", "completedTxHash": "0x..."
    }
  ]
}
```

### `GET /api/advanced/attempts/:attemptId` ★

고급강화 1건 상세 + **결과 재검증**. `verification` 은 컨트랙트의 산출 로직(roll 비교, 레벨/스트릭 전이, 보장 규칙)을 백엔드가 재현해 기록과 대조한 결과:

```json
{
  "attempt": { "...": "위와 동일 형태" },
  "verification": {
    "ok": true,
    "expected": { "resultType": 1, "afterExtraLevel": 3, "afterSafeDropStreak": 0, "...": "..." },
    "actual":   { "...": "기록값" },
    "checks": {
      "guaranteedConsistent": true, "rollMatches": true, "resultTypeMatch": true,
      "afterExtraLevelMatch": true, "afterStreakMatch": true,
      "totalLevelConsistent": true, "rateValid": true, "vrfConsistent": true
    },
    "mismatches": []
  }
}
```

`ok: false` 면 `mismatches` 배열에 어긋난 항목이 들어 있다 (조작 탐지).

### `GET /api/advanced/stats` ★

(mode, extraLevel, 적용확률) 그룹별 표기 vs 실측 + 검정. **보장(Guaranteed) 표본은 확률 사건이 아니므로 검정에서 제외.**

- Safe: 성공 vs 비성공 이항 검정 (1df)
- Risky: 성공/파괴/유지 3분 다항 검정 (2df) — **표기 파괴율 검증**이 핵심

```json
{
  "safe": [
    {
      "mode": "safe", "extraLevel": 0, "declaredSuccessRateBp": 3000,
      "observedSuccess": 30, "observedTotal": 100, "observedSuccessRateBp": 3000,
      "wilson95": { "lowBp": 2191, "highBp": 3960 },
      "chiSquare": { "stat": 0, "pValue": 1, "df": 1 },
      "fairnessVerdict": "plausible"
    }
  ],
  "risky": [
    {
      "mode": "risky", "extraLevel": 0,
      "declaredSuccessRateBp": 4500, "declaredDestroyRateBp": 500, "declaredKeepRateBp": 5000,
      "observed": { "success": 45, "destroyed": 5, "failKeep": 50, "total": 100 },
      "observedSuccessRateBp": 4500, "observedDestroyRateBp": 500, "observedKeepRateBp": 5000,
      "chiSquare": { "stat": 0, "pValue": 1, "df": 2 },
      "fairnessVerdict": "plausible"
    }
  ]
}
```

> 데이터가 없는 그룹은 배열에서 빠진다. 고급강화 시도가 0건이면 `{ "safe": [], "risky": [] }`.

---

## 랭킹

### `GET /api/ranking?limit=10`

`limit` 1~100(기본 10). 세 보드 동시 반환 — 전부 온체인 인덱싱 데이터에서 재계산 가능.

```json
{
  "limit": 10,
  "topItems":       [{ "rank": 1, "userAddress": "0x...", "itemId": "1", "baseLevel": 5, "extraLevel": 0, "totalLevel": 5 }],
  "topChallengers": [{ "rank": 1, "userAddress": "0x...", "attempts": 833 }],
  "topSuccess":     [{ "rank": 1, "userAddress": "0x...", "successes": 251 }]
}
```

- `topItems`: totalLevel 높은 순 (최고 단계 아이템)
- `topChallengers`: base + 고급강화 시도 합산 (도전왕)
- `topSuccess`: base 성공 + 고급강화 성공(Success/Guaranteed) 합산 (성공왕)

---

## 업적 NFT (EnhancementAchievements)

### `GET /api/achievements/holders`

업적 NFT 보유자 목록. 강화 이력이 있는 지갑(attempts/advanced_attempts의 distinct user)을 대상으로 업적 보유 여부를 **온체인에서 즉석 조회**한다. 보유 업적 수 내림차순(동률은 주소 오름차순), 미보유 지갑은 빠진다.

```json
{
  "contract": "0xc65089C74f1A315962BE5e172255b568a29F491c",
  "totalAchievements": 1,
  "usersChecked": 3,
  "holders": [
    { "userAddress": "0x9a7f...9aff", "claimedCount": 1, "claimedKeys": ["max_enhancement"] }
  ]
}
```

- `usersChecked`: 조회한 후보 지갑 수 (강화 이력 보유 지갑, 최대 500)
- `claimedKeys`: 보유 업적의 key 목록 — 라벨/설명은 `/api/achievements/:address` 응답과 동일한 레지스트리 기준
- 아직 아무도 클레임하지 않았으면 `holders: []` (에러 아님)
- 502 `rpc_error` / 503 `achievements_not_configured`: 아래 업적 조회 API와 동일

### `GET /api/achievements/:address?itemId=1`

계정의 업적 NFT 발급 여부를 **온체인에서 즉석 조회** (DB 미경유). `?itemId` 를 주면 해당 아이템으로 최대강화 업적을 지금 클레임할 수 있는지(`canClaimMaxEnhancement`)도 같이 응답.

```json
{
  "user": "0x9a7f...9aff",
  "contract": "0xc65089C74f1A315962BE5e172255b568a29F491c",
  "achievements": [
    {
      "achievementId": 1,
      "key": "max_enhancement",
      "label": "최대 강화 달성",
      "description": "totalLevel 이 maxLevel(=10, base 5 + 고급강화 extra 5)에 도달",
      "claimed": false
    }
  ],
  "itemId": "1",
  "canClaimMaxEnhancement": false
}
```

- 400 `invalid_address` / `invalid_itemId`
- 502 `rpc_error`: RPC 노드 장애 (재시도 권장)
- 503 `achievements_not_configured`: 서버 환경변수 미설정 (운영 이슈)

> 업적 **클레임(발급) 자체는 지갑 tx** (`claimMaxEnhancement(itemId)`) — 백엔드는 조회만 담당.
> 업적이 추가 배포되면 `achievements` 배열에 항목이 늘어난다 (응답 형태는 동일).
