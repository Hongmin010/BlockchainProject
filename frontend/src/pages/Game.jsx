import { useEffect, useCallback } from 'react';
import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Header, Badge, Button, StageBar, TxHash } from '../components';
import { WalletModal } from '../components';
import { useForge } from '../hooks/useForge';
import {
  fetchRecentAttempts,
  fetchProbabilityHistory,
  formatDateTime,
  shortenTx,
} from '../api/api';
import styles from './Game.module.css';

// 확률표 (컨트랙트 기본값 — API 로드 전 폴백)
const DEFAULT_PROB_TABLE = [
  { stage: 'Lv.0 → Lv.1', prob: 90 },
  { stage: 'Lv.1 → Lv.2', prob: 70 },
  { stage: 'Lv.2 → Lv.3', prob: 50 },
  { stage: 'Lv.3 → Lv.4', prob: 30 },
  { stage: 'Lv.4 → Lv.5', prob: 10 },
];

const CAT_EMOJIS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

// 아이템 ID는 1번으로 고정 (추후 선택 UI 확장 가능)
const ITEM_ID = 1;
// enhancementType: 0 = 기본
const ENHANCEMENT_TYPE = 0;

export default function Game({ address, onConnect, wallet }) {
  const navigate = useNavigate();
  const stageRef = useRef(null);

  // ── useForge 훅 ──────────────────────────────────────────────
  const {
    level,
    isPending,
    status,
    lastResult,
    error: forgeError,
    forge,
    refreshState,
  } = useForge({
    signer: wallet?.signer ?? null,
    provider: wallet?.provider ?? null,
    address,
  });

  // ── 최근 강화 결과 (서버) ────────────────────────────────────
  const [recentAttempts, setRecentAttempts] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);

  // ── 확률표 (서버에서 최신 값 로드) ──────────────────────────
  const [probTable, setProbTable] = useState(DEFAULT_PROB_TABLE);

  useEffect(() => {
    // 확률표 변경 이력이 있으면 최신 값으로 덮어쓰기
    fetchProbabilityHistory()
      .then(({ history }) => {
        if (!history || history.length === 0) return;
        // 레벨별 최신 newSuccessRateBp 추출
        const latestByLevel = {};
        [...history].reverse().forEach((h) => {
          if (!(h.level in latestByLevel)) {
            latestByLevel[h.level] = h.newSuccessRateBp;
          }
        });
        setProbTable(
          DEFAULT_PROB_TABLE.map((row, i) => ({
            ...row,
            prob: i in latestByLevel ? latestByLevel[i] / 100 : row.prob,
          }))
        );
      })
      .catch(() => {
        /* 폴백 유지 */
      });

    // 최근 강화 결과 초기 로드
    fetchRecentAttempts(8)
      .then((data) => {
        setRecentAttempts(data.attempts ?? []);
        setRecentLoading(false);
      })
      .catch(() => {
        setRecentLoading(false);
      });
  }, []); // 마운트 시 1번만 실행

  // 강화 완료 시 최근 목록 갱신
  useEffect(() => {
    if (status !== 'done') return;

    fetchRecentAttempts(8)
      .then((data) => {
        setRecentAttempts(data.attempts ?? []);
        setRecentLoading(false);
      })
      .catch(() => {
        setRecentLoading(false);
      });
  }, [status]);

  // ── 파티클 애니메이션 ────────────────────────────────────────
  const spawnParticles = useCallback((success) => {
    const stage = stageRef.current;
    if (!stage) return;
    const colors = success ? ['#5fc37a', '#a8f0bc'] : ['#e8623c', '#f0a090'];
    for (let i = 0; i < (success ? 8 : 4); i++) {
      const p = document.createElement('div');
      p.className = styles.particle;
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.left = 30 + Math.random() * 40 + '%';
      p.style.bottom = '30%';
      p.style.animationDelay = Math.random() * 0.3 + 's';
      stage.appendChild(p);
      setTimeout(() => p.remove(), 1200);
    }
  }, []);

  useEffect(() => {
    if (lastResult) spawnParticles(lastResult.success);
  }, [lastResult, spawnParticles]);

  // ── 지갑 미연결 ──────────────────────────────────────────────
  if (!address) {
    return (
      <>
        <Header address={address} onConnect={onConnect} />
        <WalletModal
          title="게임을 하려면 지갑이 필요해요"
          onConnect={onConnect}
          onClose={() => navigate(-1)}
        />
      </>
    );
  }

  // ── 파생 값 ──────────────────────────────────────────────────
  const isForging = status === 'waiting_tx' || status === 'waiting_vrf';
  const currentProb = level < 5 ? (probTable[level]?.prob ?? 0) : 0;

  // 최근 강화 표시용 변환
  const recentRows = recentAttempts.map((a) => ({
    tx: a.requestedTxHash ? shortenTx(a.requestedTxHash) : `#${a.attemptId}`,
    stage: `Lv.${a.beforeLevel}`,
    result: a.success ? 'S' : 'F',
    time: formatDateTime(a.requestedAt),
  }));

  // 강화 결과 상태 (UI 표시용)
  const resultState = lastResult ? (lastResult.success ? 'success' : 'fail') : null;

  return (
    <div className={styles.page}>
      <Header address={address} onConnect={onConnect} />

      <div className={styles.grid}>
        {/* ── 고양이 강화 섹션 ── */}
        <div className={styles.leftCard}>
          {/* 레벨 표시 */}
          <div className={styles.levelRow}>
            <div>
              <div className="cf-cap" style={{ marginBottom: 6 }}>
                현재 단계
              </div>
              <div className={styles.levelDisplay}>
                <span className={styles.levelCurrent}>Lv. {level}</span>
                <span style={{ color: 'var(--ink-3)' }}>→</span>
                <span className={styles.levelNext}>Lv. {level + 1}</span>
              </div>
            </div>
            <Badge>
              <span style={{ color: 'var(--ink-3)' }}>성공률</span>
              <span style={{ color: 'var(--ember-300)', fontWeight: 700 }}>{currentProb}%</span>
            </Badge>
          </div>

          {/* 단계 바 */}
          <div style={{ marginBottom: 24 }}>
            <StageBar current={level} max={5} />
          </div>

          {/* 고양이 컨테이너 */}
          <div
            ref={stageRef}
            className={`${styles.stage}
              ${resultState === 'success' ? styles.stageSuccess : ''}
              ${resultState === 'fail' ? styles.stageFail : ''}`}
          >
            <div className={styles.checker} />

            {resultState && (
              <div
                className={`${styles.resultBadge}
                  ${resultState === 'success' ? styles.resultSuccess : styles.resultFail}`}
              >
                {resultState === 'success' ? '✓ 성공!' : '✕ 실패'}
              </div>
            )}

            <div
              className={`${styles.cat}
                ${resultState === 'success' ? styles.catBounce : ''}
                ${resultState === 'fail' ? styles.catShake : ''}
                ${isForging && !resultState ? styles.catWait : ''}`}
            >
              {CAT_EMOJIS[Math.min(level, CAT_EMOJIS.length - 1)]}
            </div>

            <div className={styles.lvBadge}>LV. {level}</div>
          </div>

          {/* VRF 대기 안내 */}
          {status === 'waiting_vrf' && (
            <div
              style={{
                textAlign: 'center',
                padding: '8px 0',
                color: 'var(--ink-3)',
                fontSize: 13,
              }}
            >
              ⏳ Chainlink VRF 결과 대기 중… (약 10–30초)
            </div>
          )}

          {/* 강화 오류 */}
          {forgeError && (
            <div style={{ color: 'var(--fail)', fontSize: 13, marginTop: 4 }}>⚠ {forgeError}</div>
          )}

          {/* 강화 로그 (lastResult) */}
          {lastResult && (
            <div className={styles.logList}>
              <div className={styles.logItem}>
                <span className={styles.logStage}>
                  Lv.{lastResult.beforeLevel}→{lastResult.afterLevel}
                </span>
                <span className={lastResult.success ? styles.logSuccess : styles.logFail}>
                  {lastResult.success ? '✓ 성공' : '✕ 실패'}
                </span>
              </div>
            </div>
          )}

          {/* 액션 버튼 */}
          <div className={styles.actions}>
            <Button
              variant="primary"
              size="xl"
              onClick={() => forge(ITEM_ID, ENHANCEMENT_TYPE)}
              disabled={level >= 5 || isForging || isPending}
              loading={isForging}
              style={{ flex: '1 1 auto' }}
            >
              {level >= 5 ? '🎉 최고 레벨!' : isPending ? '⏳ 결과 대기 중…' : '⚒ 강화 시도하기'}
            </Button>
            <Button variant="secondary" size="xl" onClick={() => refreshState(ITEM_ID)}>
              새로고침
            </Button>
          </div>
          <div className={styles.gasNote}>
            <span>⛽</span>
            <span>Base Sepolia · VRF 난수로 공정 판정 · 결과는 블록체인에 기록</span>
          </div>
        </div>

        {/* ── 확률 & 기록 섹션 ── */}
        <div className={styles.rightCol}>
          {/* 단계별 확률표 */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>단계별 확률표</h3>
              <span className="cf-cap">on-chain published</span>
            </div>
            <div className={styles.probList}>
              {probTable.map(({ stage, prob }, i) => {
                const active = i === level;
                return (
                  <div
                    key={stage}
                    className={`${styles.probRow} ${active ? styles.probRowActive : ''}`}
                  >
                    <span className={`${styles.probStage} ${active ? styles.probStageActive : ''}`}>
                      {stage}
                    </span>
                    <div className={styles.probBarWrap}>
                      <div
                        className={`${styles.probBarFill} ${active ? styles.probBarActive : ''}`}
                        style={{ width: `${prob}%` }}
                      />
                    </div>
                    <span className={`${styles.probValue} ${active ? styles.probValueActive : ''}`}>
                      {prob}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 최근 강화 결과 */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>최근 강화 결과</h3>
              <span className="cf-cap">
                <span style={{ color: 'var(--success)' }}>●</span> live · 글로벌
              </span>
            </div>
            <div className={styles.recentList}>
              {recentLoading ? (
                <div
                  style={{ textAlign: 'center', padding: 20, color: 'var(--ink-3)', fontSize: 13 }}
                >
                  불러오는 중…
                </div>
              ) : recentRows.length === 0 ? (
                <div
                  style={{ textAlign: 'center', padding: 20, color: 'var(--ink-3)', fontSize: 13 }}
                >
                  기록 없음
                </div>
              ) : (
                recentRows.map(({ tx, stage, result: r, time }, idx) => (
                  <div key={idx} className={styles.recentRow}>
                    <div className={styles.recentInfo}>
                      <TxHash hash={tx} shorten={false} />
                      <span className={styles.recentSub}>
                        {stage} · {time}
                      </span>
                    </div>
                    <Badge variant={r === 'S' ? 'success' : 'fail'} dot>
                      {r === 'S' ? '성공' : '실패'}
                    </Badge>
                  </div>
                ))
              )}
              <div className={styles.recentMore}>
                <Link to="/records" className={styles.recentMoreLink}>
                  전체 보기 →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
