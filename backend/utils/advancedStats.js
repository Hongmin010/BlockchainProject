/**
 * ============================================================
 *  고급강화(상급) 통계 유틸 (★ 차별화 #1 의 고급강화판)
 * ============================================================
 *
 *  base 강화는 성공/실패 2분(이항)이지만, 고급강화는 모드별로 결과 구조가 다르다.
 *
 *   Safe  : 성공 vs 비성공(하락·유지)  → 이항(1df). 표기 성공률만 검정.
 *   Risky : 성공 / 파괴 / 유지         → 3분 다항(2df). 성공률·파괴율 동시 검정.
 *
 *  ⚠ 보장(Guaranteed) 표본은 확률 사건이 아니라 결정적 확정이므로
 *    통계 검정 분모에서 제외한다(호출부 SQL 에서 guaranteed=false 필터).
 *
 *  단계(extraLevel)·적용확률(rateBps)이 같은 표본끼리 묶어서 검정한다.
 *  (운영자가 setAdvancedRate 로 확률을 바꿨다면 서로 다른 확률 표본을
 *   섞으면 안 되므로, 호출부는 (mode, extraLevel, rateBps) 로 GROUP BY 한다.)
 * ============================================================
 */

'use strict';

const {
  bpToRate, rateToBp, wilson95Bp, chiSquare1df, chiSquareGof, fairnessVerdict,
} = require('./stats');

/**
 * Safe 모드 한 그룹 요약 — 성공 vs 비성공(이항).
 *   row = { extraLevel, declaredSuccessBp, success, total }
 *     total   : 비보장 Safe 시도 수 (보장 제외)
 *     success : resultType=Success(1) 횟수
 */
function summarizeAdvancedSafe(row) {
  const { extraLevel, declaredSuccessBp, success, total } = row;
  const declared = bpToRate(declaredSuccessBp);
  const { stat, pValue } = chiSquare1df(success, total, declared);

  return {
    mode: 'safe',
    extraLevel,
    declaredSuccessRateBp: declaredSuccessBp,
    observedSuccess: success,
    observedTotal: total,
    observedSuccessRateBp: total > 0 ? rateToBp(success / total) : 0,
    wilson95: wilson95Bp(success, total),
    chiSquare: { stat, pValue, df: 1 },
    fairnessVerdict: fairnessVerdict(total, pValue),
  };
}

/**
 * Risky 모드 한 그룹 요약 — 성공/파괴/유지(3분 다항, 2df).
 *   row = { extraLevel, declaredSuccessBp, declaredDestroyBp,
 *           success, destroyed, failKeep, total }
 *     total = success + destroyed + failKeep (보장 없음)
 */
function summarizeAdvancedRisky(row) {
  const {
    extraLevel, declaredSuccessBp, declaredDestroyBp,
    success, destroyed, failKeep, total,
  } = row;

  const pS = bpToRate(declaredSuccessBp);
  const pD = bpToRate(declaredDestroyBp);
  const pK = Math.max(0, 1 - pS - pD); // 유지 = 나머지

  const gof = chiSquareGof([success, destroyed, failKeep], [pS, pD, pK]);

  return {
    mode: 'risky',
    extraLevel,
    declaredSuccessRateBp: declaredSuccessBp,
    declaredDestroyRateBp: declaredDestroyBp,
    declaredKeepRateBp: rateToBp(pK),
    observed: { success, destroyed, failKeep, total },
    observedSuccessRateBp: total > 0 ? rateToBp(success / total) : 0,
    observedDestroyRateBp: total > 0 ? rateToBp(destroyed / total) : 0,
    observedKeepRateBp: total > 0 ? rateToBp(failKeep / total) : 0,
    chiSquare: { stat: gof.stat, pValue: gof.pValue, df: gof.df },
    fairnessVerdict: fairnessVerdict(total, gof.pValue),
  };
}

module.exports = { summarizeAdvancedSafe, summarizeAdvancedRisky };
