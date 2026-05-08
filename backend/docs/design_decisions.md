# 백엔드 설계 결정

> 본 문서는 V1 → V2 단순화 과정에서 내려진 핵심 설계 결정을 기록한다.
> 발표 시 "왜 이렇게 만들었는가" 에 답하기 위한 자료이며,
> 본구현 단계 합의서의 일부로도 사용된다.

---

## 결정 1: 이벤트 vs 테이블 책임 분리

### 배경

V1 명세에는 `UserItemStateUpdated` 라는 이벤트가 있었다.
강화 결과로 사용자 아이템 상태(현재 단계, 누적 시도 횟수)가 변경됐을 때
컨트랙트가 emit 하고, 백엔드 인덱서가 `user_items` 테이블을 UPSERT 하는 구조였다.

V2 단순화 검토 중, 이 이벤트의 존재 가치를 다시 물었다.

### 분석

- **우리 시스템 범위 확인**: 강화 외에 아이템 상태를 바꾸는 경로가 있는가?
  → 없다. 거래/합성/소각 같은 다른 상태 변경 경로는 본 프로젝트 범위 밖.
- **정보 출처 확인**: 사용자 아이템 상태(`level`)는 어디서 결정되는가?
  → `EnhancementCompleted.afterLevel` 이 곧 강화 후 단계.
- **즉, 결론**: `UserItemStateUpdated` 의 모든 정보는 `EnhancementCompleted` 만 보면
  100% 추론 가능하다. 두 이벤트는 **정보 중복**이다.

### 결정

- **컨트랙트**: `UserItemStateUpdated` 를 emit하지 않는다. (가스 절감)
- **백엔드**: 인덱서의 `EnhancementCompleted` 핸들러에서 `user_items` 를 자동 UPSERT.
- **무결성**: `attempts` UPDATE 와 `user_items` UPSERT 를 한 DB 트랜잭션으로 묶어
  "결과는 기록됐는데 사용자 상태는 안 바뀐" 같은 인콘시스턴시를 차단.

### 트레이드오프

| 항목 | 영향 |
| --- | --- |
| 가스 비용 | 강화 1회당 ~1,600 gas (~13%) 절감 — emit 1회 제거 + 라이프사이클 통합 |
| DB 무결성 | DB 트랜잭션으로 강화됨 (이벤트 분리 시 race-condition 가능성 있었음) |
| 코드 복잡도 | 핸들러 1개 안에 두 테이블 갱신 — 복잡도 약간 ↑, 단 명시적이고 추적 가능 |
| 유연성 | 향후 강화 외 상태 변경 경로 도입 시 이벤트 추가 필요 — 단, 현재 범위 내에선 불필요 |

결론: **시니어 설계 원칙(중복 제거, 비용 주체 분리, 무결성 우선)에 부합한다.**

### 시니어 사고 핵심

> **"이벤트는 컨트랙트의 비용 = 사용자 가스"**
> **"테이블은 백엔드의 비용 = 운영자 인프라"**
> → 두 비용 주체가 다르다
> → 따라서 따로 결정해야 한다

이벤트와 테이블을 1:1 로 묶어버리는 사고는 비용 주체를 한쪽으로 통일해버린다.
분리해서 보면 "사용자 가스는 줄이고 운영자 무결성은 강화한다" 는 양쪽 모두 좋은 결정이 가능해진다.

---

## 결정 2: VRF 라이프사이클 통합

### 배경

V1 명세는 강화 라이프사이클을 4단계로 별도 이벤트로 발행했다.

1. `EnhancementAttempted` — 사용자가 강화 요청
2. `RandomnessRequested` — 컨트랙트가 VRF Coordinator 에 난수 요청 송신
3. `RandomnessFulfilled` — VRF 콜백 도착
4. `EnhancementResult` — 강화 결과 확정

각각 별도 이벤트, 별도 핸들러, 별도 테이블(혹은 분리된 컬럼)이었다.

### 분석

- **사용자 관점**: 의미 있는 사건은 "시도했다 / 결과가 나왔다" 두 단계뿐.
  VRF 송신/콜백은 내부 구현 디테일이며, 사용자가 받아갈 정보량이 늘지 않는다.
- **운영자 관점**: VRF 응답 지연 같은 메타 정보가 유용했지만,
  요청 시점과 결과 시점의 블록 메타(`requested_at`, `completed_at`)만으로 충분히 측정 가능.
- **별도 이벤트의 비용**: emit 1회당 LOG 오피코드 + 토픽 인코딩으로 수백 gas씩 추가.
  4개 → 2개로 줄이면 강화 1회당 합계 약 1,000+ gas 절감 효과.

### 결정

- **요청 단계 통합**: `EnhancementAttempted` + `RandomnessRequested` → `EnhancementRequested`
  - 컨트랙트는 강화 요청 함수 안에서 VRF 송신을 동기적으로 호출하므로
    `randomnessRequestId` 도 같은 트랜잭션에서 알 수 있다 → 한 이벤트에 담을 수 있다.
- **결과 단계 통합**: `EnhancementResult` + `RandomnessFulfilled` → `EnhancementCompleted`
  - VRF 콜백이 결과 산출을 트리거하므로 `randomValue` 와 `success` 가 같은 콜백 안에서 결정된다 → 한 이벤트에 담을 수 있다.

### 트레이드오프

| 항목 | 영향 |
| --- | --- |
| 가스 절감 | emit 4회 → 2회 (강화 1회 기준) |
| 정보 손실 | 없음 — 모든 V1 필드는 V2 두 이벤트에 흡수됨 |
| VRF 지연 측정 | 가능 — `completed_at - requested_at` 로 동일하게 산출 |
| 인덱서 단순화 | 핸들러 4개 → 2개, 1:1 테이블이던 `vrf_requests` 흡수 |

### 결론

**VRF 라이프사이클은 우리 서비스의 본질이 아니다.** 우리 서비스의 본질은
"강화의 정직성 검증"이며, 그것은 시도 + 결과 두 사건만으로 충분히 검증 가능하다.

---

## 결정 3: ProbabilityTableUpdated 유지

### 배경

V2 단순화 검토 중, "혹시 이 이벤트도 통합/제거 대상인가?" 를 검토했다.

### 분석

- **라이프사이클이 다르다**: `EnhancementRequested/Completed` 는 사용자 행위 신호이고,
  `ProbabilityTableUpdated` 는 운영자 행위 신호다. 발생 주체가 다르다.
- **시도 없는 시점에도 발생 가능**: 강화 시도가 한 건도 없는 상태에서도 운영자는
  확률표를 변경할 수 있고, 그 변경 자체가 감사 기록으로 보존되어야 한다.
- **정보 추론 불가**: 다른 이벤트로부터 "확률표가 언제 어떻게 바뀌었는지" 를
  추론할 수 없다 → 독립 이벤트가 필요하다.
- **차별화 핵심**: 본 프로젝트의 차별화 포인트 #3(확률표 변경 추적)의 근간이다.
  운영사의 사일런트 너프(silent nerf) 행위를 차단하는 핵심 신호.

### 결정

- **이벤트 변경 없음**: `ProbabilityTableUpdated` 는 V1 그대로 유지.
- **테이블 변경 없음**: `probability_history` 도 V1 그대로 유지.

### 결론

"통합/제거가 가능한가?" 와 "통합/제거가 정당한가?" 는 다른 질문이다.
이 이벤트는 **다른 신호로부터 추론 불가능**하고, **사용자 행위와 라이프사이클이 다르며**,
**시도 없는 단계 변경 추적용 안전장치** 역할을 한다 → 독립 이벤트로 유지가 정답.

---

## 부록: V1 → V2 변경 매핑

### 이벤트
```
EnhancementAttempted ┐
RandomnessRequested  ┴→ EnhancementRequested

EnhancementResult    ┐
RandomnessFulfilled  ┴→ EnhancementCompleted

UserItemStateUpdated → 제거 (백엔드가 EnhancementCompleted 처리 시 자동 갱신)
ProbabilityTableUpdated → 유지
```

### 테이블
```
attempts             → 확장 (randomness_request_id 컬럼 추가, status enum 'completed')
vrf_requests         → 제거 (attempts 에 흡수)
user_items           → 유지 (★ 이벤트 없이 백엔드가 자동 UPSERT)
probability_history  → 유지
indexer_cursor       → 유지
```

### V2 단순화의 핵심 사고 (3줄 요약)

1. **"강화 외 경로 없음 → UserItemStateUpdated 중복"**
2. **"VRF 라이프사이클은 우리 서비스 본질 아님 → 통합"**
3. **"이벤트는 사용자 비용, 테이블은 운영자 비용 → 분리 결정"**
