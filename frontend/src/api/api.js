/**
 * axios 인스턴스 + CatForge 백엔드 API 함수 모음
 *
 * 사용법
 * ──────
 * import { fetchGlobalStats, fetchStatsByLevel, fetchUserStats,
 *          fetchRecentAttempts, fetchAttempt } from '../api/api';
 */

import axios from 'axios';

// ─── axios 인스턴스 ─────────────────────────────────────────────
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

// 응답 인터셉터 — 에러를 일관된 형태로 변환
api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const msg =
      err?.response?.data?.message ??
      err?.response?.data?.error ??
      err?.message ??
      '알 수 없는 오류가 발생했습니다.';
    return Promise.reject(new Error(msg));
  }
);

// ─── /api/stats ────────────────────────────────────────────────

/**
 * GET /api/stats/global
 * 전체 누적 통계
 *
 * 반환 예시
 * {
 *   completedAttempts: 48217,
 *   successes: 25217,
 *   observedRateBp: 5230,   // 52.30% = 5230bp
 *   uniqueUsers: 312,
 *   avgVrfLatencySec: 12.4
 * }
 */
export async function fetchGlobalStats() {
  return api.get('/api/stats/global');
}

/**
 * GET /api/stats/by-level
 * 단계별 공개 확률 vs 실측 성공률 + 통계 검정 결과
 *
 * 반환 예시
 * {
 *   levels: [
 *     {
 *       beforeLevel: 0,
 *       declaredRateBp: 9000,
 *       observedSuccess: 8101,
 *       observedTotal: 9000,
 *       observedRateBp: 9001,
 *       wilson95: { lowBp: 8950, highBp: 9052 },
 *       chiSquare: { stat: 0.12, pValue: 0.73 },
 *       fairnessVerdict: 'plausible'   // 'plausible' | 'suspicious' | 'insufficient_data'
 *     }, ...
 *   ]
 * }
 */
export async function fetchStatsByLevel() {
  return api.get('/api/stats/by-level');
}

/**
 * GET /api/stats/user/:address
 * 특정 주소의 통계 + 보유 아이템 목록
 *
 * @param {string} address  — 0x... 체크섬 or 소문자
 *
 * 반환 예시
 * {
 *   address: '0xabc...',
 *   completedAttempts: 128,
 *   successes: 71,
 *   observedRateBp: 5547,
 *   items: [
 *     { itemId: '1', level: 3, totalAttempts: 128, lastUpdatedAt: '2026-05-06T...' }
 *   ]
 * }
 */
export async function fetchUserStats(address) {
  return api.get(`/api/stats/user/${address}`);
}

// ─── /api/attempts ─────────────────────────────────────────────

/**
 * GET /api/attempts/recent?limit=N
 * 최근 강화 목록 (기본 20건, 최대 100)
 *
 * @param {number} limit
 *
 * 반환 예시
 * {
 *   limit: 20,
 *   attempts: [
 *     {
 *       attemptId: 4219,
 *       userAddress: '0x...',
 *       itemId: '1',
 *       beforeLevel: 3,
 *       afterLevel: 4,
 *       claimedSuccessRateBp: 3000,
 *       success: true,
 *       vrfRequestId: '0x...',
 *       randomValue: '2841',
 *       status: 'completed',
 *       requestedAt: '2026-05-06T14:21:00Z',
 *       completedAt: '2026-05-06T14:21:14Z',
 *       requestedTxHash: '0x9f2a...',
 *       completedTxHash: '0x771c...'
 *     }, ...
 *   ]
 * }
 */
export async function fetchRecentAttempts(limit = 20, user = null) {
  const params = { limit };
  if (user) params.user = user;
  return api.get('/api/attempts/recent', { params });
}

/**
 * GET /api/attempts/:attemptId
 * 강화 1건 상세 + VRF 재검증 결과
 *
 * @param {number|string} attemptId
 *
 * 반환 예시
 * {
 *   attempt: { ...formatAttempt 결과 },
 *   verification: {
 *     successDerived: true,
 *     matchesContract: true,
 *     formula: '(randomValue % 10000) < claimedSuccessRate'
 *   } | null
 * }
 */
export async function fetchAttempt(attemptId) {
  return api.get(`/api/attempts/${attemptId}`);
}

// ─── /api/probability ──────────────────────────────────────────

/**
 * GET /api/probability/history?level=N
 * 확률표 변경 이력
 *
 * @param {number|null} level  — null 이면 전체 레벨
 *
 * 반환 예시
 * {
 *   level: null,
 *   history: [
 *     {
 *       level: 2,
 *       oldSuccessRateBp: 5000,
 *       newSuccessRateBp: 4500,
 *       onChainTimestamp: '2026-04-01T...',
 *       txHash: '0x...',
 *       logIndex: 0,
 *       blockNumber: 19000000
 *     }, ...
 *   ]
 * }
 */
export async function fetchProbabilityHistory(level = null) {
  const params = level != null ? { level } : {};
  return api.get('/api/probability/history', { params });
}

// ─── 유틸 ──────────────────────────────────────────────────────

/**
 * bp(베이시스 포인트) → 퍼센트 문자열
 * bpToPercent(5230) → '52.30'
 */
export function bpToPercent(bp) {
  return (bp / 100).toFixed(2);
}

/**
 * tx 해시 단축 표시
 * shortenTx('0x9f2a4c...7e8f9') → '0x9f2a…e8f9'
 */
export function shortenTx(hash, front = 6, back = 4) {
  if (!hash || hash.length < front + back) return hash;
  return `${hash.slice(0, front)}…${hash.slice(-back)}`;
}

/**
 * 타임스탬프 → 'YYYY-MM-DD HH:mm' (KST)
 */
export function formatDateTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default api;
