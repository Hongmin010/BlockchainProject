/**
 * ============================================================
 *  REST API 서버 (Express) — v1.0
 * ============================================================
 *
 *  목적
 *  ----
 *  인덱서가 채워둔 PostgreSQL 데이터를 외부(프론트엔드 데모,
 *  발표 대시보드)에 노출한다.
 *
 *  설계 원칙
 *  ---------
 *  - 모든 경로는 `/api/*` prefix 로 통일.
 *  - 응답은 항상 JSON. 에러 응답도 { error, message } 형태로 통일.
 *  - 데이터 가공(통계 검정 등)은 SQL 한 방으로 처리하기보다,
 *    Node 측 유틸 함수로 분리하여 단위 테스트 가능하도록 둔다.
 *
 *  엔드포인트 요약 (★ = 차별화 포인트와 직접 연결)
 *  ----------------------------------------------
 *   GET /health                          서버/DB 헬스체크
 *
 *   GET /api/stats/by-level              ★ 단계별 표기 vs 실측 + 통계 검정
 *   GET /api/stats/global                전체 누적 통계
 *   GET /api/stats/user/:address         사용자별 시도 통계
 *
 *   GET /api/attempts/recent             최근 시도 목록 (대시보드용)
 *   GET /api/attempts/:attemptId         ★ 시도 1건 상세 + VRF 재검증 결과
 *
 *   GET /api/probability/history         ★ 확률표 변경 이력
 *
 *  ※ 차별화 포인트 매핑
 *     #1 통계 검정 (Wilson 95% CI + 카이제곱 p-value)
 *        → /api/stats/by-level, /api/stats/global, /api/stats/user/:address
 *     #2 VRF 재검증 (off-chain re-derivation)
 *        → /api/attempts/:attemptId
 *     #3 확률표 변경 추적
 *        → /api/probability/history
 * ============================================================
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// ------------------------------------------------------------
//  공통 미들웨어
// ------------------------------------------------------------
//  CORS: 발표 데모 페이지(별도 도메인)에서 호출할 수 있도록 전체 허용.
//  운영 환경에선 origin 화이트리스트로 좁힐 것.
app.use(cors());
app.use(express.json());

// 간이 요청 로거 (placeholder — 추후 morgan 도입 가능)
app.use((req, _res, next) => {
  console.log(`[api] ${req.method} ${req.url}`);
  next();
});


// ------------------------------------------------------------
//  헬스체크
// ------------------------------------------------------------
app.get('/health', (_req, res) => {
  // TODO: DB 핑(SELECT 1)도 함께 수행하여 DB 가용성까지 응답
  res.json({
    status: 'ok',
    service: 'khu-blockchain-backend',
    timestamp: new Date().toISOString(),
  });
});


// ============================================================
//  /api/stats/* — 통계 검정 계열 (차별화 #1)
// ============================================================

/**
 * GET /api/stats/by-level   ★ 메인 엔드포인트
 *
 *  반환 형식 (예시)
 *  ---------------
 *  {
 *    levels: [
 *      {
 *        beforeLevel: 7,
 *        declaredRateBp: 5000,        // 표기 확률 (basis point)
 *        observedSuccess: 412,        // 실측 성공 횟수
 *        observedTotal:   823,        // 실측 시도 총수
 *        observedRateBp:  5006,       // 412/823 → bp 환산
 *        wilson95: { lowBp: 4660, highBp: 5350 },   // Wilson 95% CI
 *        chiSquare: { stat: 0.003, pValue: 0.954 }, // H0: declared==observed
 *        fairnessVerdict: 'plausible' // plausible | suspicious | insufficient_data
 *      },
 *      ...
 *    ]
 *  }
 *
 *  fairnessVerdict 결정 규칙(초안)
 *   - observedTotal < 30   → 'insufficient_data'
 *   - p < 0.01             → 'suspicious'
 *   - 그 외                 → 'plausible'
 */
app.get('/api/stats/by-level', async (_req, res) => {
  // TODO:
  //  1) SELECT before_level, COUNT(*) AS total, COUNT(success) FILTER (WHERE success) AS hits,
  //            AVG(claimed_success_rate)::int AS declared_bp
  //     FROM attempts WHERE status='fulfilled' GROUP BY before_level
  //  2) Wilson CI 계산 (utils/stats.js 로 분리 예정)
  //  3) 카이제곱 검정 1자유도 — chi2 = (observed - expected)^2 / expected * ...
  //  4) fairnessVerdict 라벨 부착
  res.status(501).json({ error: 'not_implemented', message: '발표 후 본구현 예정' });
});

/** GET /api/stats/global — 전체 누적 통계 */
app.get('/api/stats/global', async (_req, res) => {
  // TODO: 전체 시도 수, 성공률, 활성 사용자 수, 누적 VRF 응답 평균 지연 등
  res.status(501).json({ error: 'not_implemented' });
});

/** GET /api/stats/user/:address — 사용자별 시도/성공률 */
app.get('/api/stats/user/:address', async (req, res) => {
  const { address } = req.params;
  // TODO: address lowercase 정규화 + 유효성 검증(0x..40hex) 후 DB 조회
  res.status(501).json({ error: 'not_implemented', address });
});


// ============================================================
//  /api/attempts/* — 시도 조회 + VRF 재검증 (차별화 #2)
// ============================================================

/** GET /api/attempts/recent — 최근 시도 목록 (limit=20 default) */
app.get('/api/attempts/recent', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  // TODO: SELECT * FROM attempts ORDER BY attempted_at DESC LIMIT $limit
  res.status(501).json({ error: 'not_implemented', limit });
});

/**
 * GET /api/attempts/:attemptId   ★ VRF 재검증 엔드포인트
 *
 *  attempts + vrf_requests 를 JOIN 하여 하나의 시도에 대한
 *  요청-VRF요청-VRF응답-결과 4단계 일치 여부를 반환한다.
 *
 *  반환 형식 (예시)
 *  ---------------
 *  {
 *    attempt: { ... attempts row ... },
 *    vrf:     { ... vrf_requests row ... },
 *    verification: {
 *      randomValueMatch: true,       // attempts.random_value == vrf_requests.random_value ?
 *      successDerived:   true,       // 우리 측 재계산한 success 와 컨트랙트 결과 일치 ?
 *      // 재계산 방법: (randomValue % 10000) < successRate ⇒ success
 *      // (실제 컨트랙트 로직과 동일하게 맞춰야 함 — 본구현 시 컨트랙트 팀과 공식 확정)
 *    }
 *  }
 */
app.get('/api/attempts/:attemptId', async (req, res) => {
  const { attemptId } = req.params;
  // TODO: 위 verification 로직 구현
  res.status(501).json({ error: 'not_implemented', attemptId });
});


// ============================================================
//  /api/probability/* — 확률표 변경 추적 (차별화 #3)
// ============================================================

/**
 * GET /api/probability/history
 *
 *  쿼리: ?level=7  (선택) — 특정 단계만 필터.
 *  반환: 변경 이력 시간순(최신 → 과거).
 */
app.get('/api/probability/history', async (req, res) => {
  const level = req.query.level !== undefined ? Number(req.query.level) : null;
  // TODO: SELECT level, old_success_rate, new_success_rate, on_chain_timestamp,
  //              tx_hash, block_number
  //       FROM probability_history
  //       WHERE ($1::int IS NULL OR level = $1)
  //       ORDER BY block_number DESC
  res.status(501).json({ error: 'not_implemented', level });
});


// ------------------------------------------------------------
//  공통 에러 핸들러 (라우트 매치 실패 + 라우트 내부 throw)
// ------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((err, _req, res, _next) => {
  console.error('[api] 처리 중 오류:', err);
  res.status(500).json({ error: 'internal_error', message: err.message });
});


// ------------------------------------------------------------
//  서버 시작
// ------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[api] 서버 부팅 완료: http://localhost:${PORT}`);
  });
}

module.exports = app;
