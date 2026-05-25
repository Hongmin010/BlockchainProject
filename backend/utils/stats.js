/**
 * ============================================================
 *  통계 유틸 — Wilson 95% CI + 카이제곱(1df) p-value + 공정성 판정
 * ============================================================
 *
 *  목적
 *  ----
 *  /api/stats/by-level 의 핵심 계산을 SQL 밖, 순수 함수로 분리.
 *  단위 테스트로 정확성을 보장한다.
 *  컨트랙트 명세 확정 / 인덱서 데이터 적재와 독립적으로 작업 가능한 영역.
 *
 *  채택 공식과 근거
 *  ----------------
 *  1) Wilson score 95% CI
 *      - 작은 표본에서 Normal-approx(Wald) 보다 신뢰성 높음 — 양 극단(p≈0, p≈1)에서도
 *        구간이 [0,1] 밖으로 새지 않는다.
 *      - z = 1.959963984540054 (양측 95%)
 *      - 참고: Wikipedia "Binomial proportion confidence interval"
 *
 *  2) 카이제곱 검정 (1자유도, 2-cell)
 *      - H0: 표기 확률 == 실측 비율
 *      - χ² = Σ (O-E)² / E  (성공/실패 두 셀)
 *      - 1df 카이제곱의 생존함수 (= 우꼬리 확률) 는 닫힌형:
 *            p = erfc( sqrt(χ²/2) )
 *      - erfc 는 Abramowitz & Stegun 7.1.26 근사 (정밀도 ~1.5e-7) — p-value
 *        표시 용도엔 충분.
 *
 *  3) fairnessVerdict (server.js 라우트 주석에서 확정된 초안)
 *      - observedTotal < 30  → 'insufficient_data'  (정규근사 신뢰 임계)
 *      - p < 0.01            → 'suspicious'
 *      - 그 외               → 'plausible'
 *
 *  basis point(bp) 규약
 *  --------------------
 *   - 컨트랙트/DB 의 successRate 는 모두 bp 단위 (0~10000 = 0~100%)
 *   - 본 모듈 내부 계산은 비율(0~1) 도메인에서 수행하고,
 *     응답 객체에는 *Bp 접미사로 통일해 정수 bp 로 환산.
 * ============================================================
 */

'use strict';

// ------------------------------------------------------------
//  상수
// ------------------------------------------------------------
const Z_95 = 1.959963984540054;        // 양측 95% 표준정규 분위수
const BP_DENOMINATOR = 10_000;          // basis point 분모
const MIN_SAMPLE_FOR_VERDICT = 30;      // 'insufficient_data' 컷오프
const SUSPICIOUS_P_THRESHOLD = 0.01;    // 'suspicious' 컷오프


// ------------------------------------------------------------
//  bp ↔ rate 변환 헬퍼
// ------------------------------------------------------------
function bpToRate(bp) {
  return bp / BP_DENOMINATOR;
}

function rateToBp(rate) {
  // 음수/오버플로는 클램프, 정수 반올림
  if (rate < 0) return 0;
  if (rate > 1) return BP_DENOMINATOR;
  return Math.round(rate * BP_DENOMINATOR);
}


// ------------------------------------------------------------
//  Wilson 95% CI
// ------------------------------------------------------------
/**
 * Wilson score interval (양측 95%).
 *
 *   x   : 성공 횟수 (정수 >= 0)
 *   n   : 전체 시도 (정수 >  0)
 *   반환: { low, high }  ∈ [0,1] × [0,1]
 *
 *   n = 0 인 경우 정의되지 않으므로 가장 넓은 구간 { low:0, high:1 } 을 반환한다.
 */
function wilson95(x, n) {
  if (n <= 0) return { low: 0, high: 1 };
  if (x < 0 || x > n) {
    throw new RangeError(`wilson95: invalid input x=${x}, n=${n}`);
  }

  const z = Z_95;
  const z2 = z * z;
  const pHat = x / n;
  const denom = 1 + z2 / n;
  const center = (pHat + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt(pHat * (1 - pHat) / n + z2 / (4 * n * n))) / denom;

  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

/** Wilson 95% CI 를 bp 정수로 환산한 형태 (API 응답용). */
function wilson95Bp(x, n) {
  const { low, high } = wilson95(x, n);
  return { lowBp: rateToBp(low), highBp: rateToBp(high) };
}


// ------------------------------------------------------------
//  카이제곱 검정 (1자유도)
// ------------------------------------------------------------
/**
 * H0: 표기 확률 `declared` 와 실측 성공률 (x/n) 이 같다.
 *
 *   x         : 실측 성공 횟수
 *   n         : 실측 시도 총수
 *   declared  : 표기 확률 (0~1)
 *   반환      : { stat, pValue }
 *
 *   E_hit  = n * declared
 *   E_miss = n * (1 - declared)
 *   χ²     = (x - E_hit)² / E_hit + ((n-x) - E_miss)² / E_miss
 *   p      = erfc( sqrt(χ²/2) )       — 1df 카이제곱 생존함수 (= 우꼬리)
 */
function chiSquare1df(x, n, declared) {
  if (n <= 0) {
    return { stat: 0, pValue: 1 };
  }
  if (declared <= 0 || declared >= 1) {
    // 0% 또는 100% 표기 — H0 자체가 degenerate, 정규 χ² 가 정의되지 않는다.
    // 모든 시도가 명세대로면 p=1, 한 건이라도 어긋나면 p=0 으로 처리한다.
    const allMatch = (declared === 0 && x === 0) || (declared === 1 && x === n);
    return { stat: allMatch ? 0 : Infinity, pValue: allMatch ? 1 : 0 };
  }

  const eHit = n * declared;
  const eMiss = n * (1 - declared);
  const dHit = x - eHit;
  const dMiss = (n - x) - eMiss;
  const stat = (dHit * dHit) / eHit + (dMiss * dMiss) / eMiss;

  const pValue = erfc(Math.sqrt(stat / 2));
  return { stat, pValue };
}


/**
 * 보완 오차함수 erfc(x) = 1 - erf(x).
 *
 *  Abramowitz & Stegun 7.1.26 근사 (정밀도 ~1.5e-7).
 *  음수 입력은 erfc(-x) = 2 - erfc(x) 항등식으로 처리.
 */
function erfc(x) {
  if (x < 0) return 2 - erfc(-x);

  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((
        1.061405429  * t
      - 1.453152027) * t
      + 1.421413741) * t
      - 0.284496736) * t
      + 0.254829592) * t) * Math.exp(-x * x);
  return 1 - y;
}


// ------------------------------------------------------------
//  공정성 판정
// ------------------------------------------------------------
/**
 * @returns {'insufficient_data' | 'suspicious' | 'plausible'}
 */
function fairnessVerdict(observedTotal, pValue) {
  if (observedTotal < MIN_SAMPLE_FOR_VERDICT) return 'insufficient_data';
  if (pValue < SUSPICIOUS_P_THRESHOLD) return 'suspicious';
  return 'plausible';
}


// ------------------------------------------------------------
//  단계별 통계 한 행 정형화 (라우트에서 그대로 쓸 수 있는 어댑터)
// ------------------------------------------------------------
/**
 * by-level GROUP BY 한 행을 받아 API 응답 객체로 변환.
 *
 *   row = { beforeLevel, declaredBp, hits, total }
 *   반환 = {
 *     beforeLevel,
 *     declaredRateBp,            // 표기 확률 (bp)
 *     observedSuccess,           // 실측 성공
 *     observedTotal,             // 실측 총수
 *     observedRateBp,            // 실측 성공률 (bp)
 *     wilson95:  { lowBp, highBp },
 *     chiSquare: { stat, pValue },
 *     fairnessVerdict,
 *   }
 */
function summarizeLevel(row) {
  const { beforeLevel, declaredBp, hits, total } = row;
  const declared = bpToRate(declaredBp);

  const wilson = wilson95Bp(hits, total);
  const { stat, pValue } = chiSquare1df(hits, total, declared);

  return {
    beforeLevel,
    declaredRateBp: declaredBp,
    observedSuccess: hits,
    observedTotal: total,
    observedRateBp: total > 0 ? rateToBp(hits / total) : 0,
    wilson95: wilson,
    chiSquare: { stat, pValue },
    fairnessVerdict: fairnessVerdict(total, pValue),
  };
}


// ------------------------------------------------------------
//  exports
// ------------------------------------------------------------
module.exports = {
  // 상수
  Z_95,
  BP_DENOMINATOR,
  MIN_SAMPLE_FOR_VERDICT,
  SUSPICIOUS_P_THRESHOLD,
  // 변환
  bpToRate,
  rateToBp,
  // 통계
  wilson95,
  wilson95Bp,
  chiSquare1df,
  erfc,
  // 라벨링
  fairnessVerdict,
  // 라우트 어댑터
  summarizeLevel,
};
