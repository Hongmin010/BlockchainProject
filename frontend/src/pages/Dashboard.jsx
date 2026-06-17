import { useEffect, useState } from 'react';
import { Header } from '../components';
import {
  fetchGlobalStats,
  fetchStatsByLevel,
  fetchAdvancedStats,
  fetchAdvancedRatesHistory,
  latestAdvancedRates,
  bpToPercent,
  formatDateTime,
} from '../api/api';
import styles from './Dashboard.module.css';

// 상태 처리 - 로딩
function Spinner() {
  return (
    <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-3)', fontSize: 14 }}>
      불러오는 중…
    </div>
  );
}

// 상태 처리 - 에러
function ErrorMsg({ msg }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--fail)', fontSize: 14 }}>
      ⚠ {msg}
    </div>
  );
}

const CIRCUMFERENCE = 2 * Math.PI * 80;

// 상급 강화 단계 라벨: extraLevel 0~14 (Lv.5→6 ... Lv.19→20), 총 15단계
const ADV_LEVEL_LABELS = Array.from({ length: 15 }, (_, i) => `Lv.${5 + i}→${6 + i}`);

// 행의 표본 수 (safe는 observedTotal, risky는 observed.total)
const advSampleSize = (row) => row.observedTotal ?? row.observed?.total ?? 0;

/**
 * 같은 단계(extraLevel)에 적용확률이 다른 그룹이 여러 개 올 수 있어
 * (운영자가 확률 변경 시 백엔드가 표본을 분리함)
 * 단계당 표본이 가장 많은 그룹을 대표로 선택한다.
 * — rates/history에 해당 그룹 이력이 없을 때의 폴백.
 */
function pickRepresentative(rows, extraLevel) {
  const candidates = (rows ?? []).filter((r) => r.extraLevel === extraLevel);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, r) => (advSampleSize(r) > advSampleSize(best) ? r : best));
}

/** stats 행 중 선언 확률이 (successBp[, destroyBp])와 일치하는 그룹 찾기 */
function findGroup(rows, extraLevel, successBp, destroyBp, isRisky) {
  return (
    (rows ?? []).find(
      (r) =>
        r.extraLevel === extraLevel &&
        r.declaredSuccessRateBp === successBp &&
        (!isRisky || r.declaredDestroyRateBp === destroyBp)
    ) ?? null
  );
}

/**
 * 차트에 표시할 그룹 선택: 현재 적용 확률(rates/history 최신 항목) 그룹 우선.
 * - 이력이 없으면 표본 최다 그룹 폴백
 * - 새 확률로 아직 표본이 없으면 공개 확률만 있는 행 반환 (noSample)
 */
function pickCurrentGroup(rows, extraLevel, hist, isRisky) {
  if (!hist) return pickRepresentative(rows, extraLevel);
  const match = findGroup(rows, extraLevel, hist.newSuccessRateBp, hist.newDestroyRateBp, isRisky);
  if (match) return match;
  return {
    extraLevel,
    declaredSuccessRateBp: hist.newSuccessRateBp,
    declaredDestroyRateBp: isRisky ? hist.newDestroyRateBp : undefined,
    noSample: true,
  };
}

/** 최초 설정 이벤트 여부 (이전 값이 전부 0 — 변경 이력 리스트에서 제외) */
function isInitialRateEvent(h) {
  return h.oldSuccessRateBp === 0 && (h.mode !== 1 || h.oldDestroyRateBp === 0);
}

export default function Dashboard({ address, onConnect }) {
  const [globalStats, setGlobalStats] = useState(null);
  const [levelStats, setLevelStats] = useState(null);
  const [advStats, setAdvStats] = useState(null); // { safe: [...], risky: [...] }
  const [rateHistory, setRateHistory] = useState([]); // 상급 확률 변경 이력 (최신순)
  const [advMode, setAdvMode] = useState('safe');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    // 상급 강화 통계 — 실패해도 기존 차트는 그대로 표시
    fetchAdvancedStats()
      .then((data) => {
        if (!cancelled) setAdvStats(data);
      })
      .catch(() => {});

    // 상급 확률 변경 이력 — 실패 시 표본 최다 그룹 폴백으로 동작
    fetchAdvancedRatesHistory()
      .then((data) => {
        if (!cancelled) setRateHistory(data.history ?? []);
      })
      .catch(() => {});

    Promise.all([fetchGlobalStats(), fetchStatsByLevel()])
      .then(([global, byLevel]) => {
        if (cancelled) return;
        setLoading(false);
        setError(null);
        setGlobalStats(global);
        setLevelStats(byLevel.levels);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 요약 카드 데이터
  const summaryCards = globalStats
    ? [
        {
          label: '전체 강화 시도',
          value: globalStats.completedAttempts.toLocaleString(),
          sub: 'cumulative',
        },
        {
          label: '전체 성공률',
          value: `${bpToPercent(globalStats.observedRateBp)}%`,
          sub: `expected ~52.10%`,
          tone: 'success',
        },
        {
          label: '총 고유 유저',
          value: globalStats.uniqueUsers.toLocaleString(),
          sub: `VRF 평균 대기 ${globalStats.avgVrfLatencySec?.toFixed(1) ?? '—'}s`,
        },
      ]
    : [];

  // 도넛 차트 값
  const successRate = globalStats ? globalStats.successes / globalStats.completedAttempts : 0;
  const successCount = globalStats?.successes ?? 0;
  const failCount = globalStats ? globalStats.completedAttempts - globalStats.successes : 0;
  const successPct = globalStats ? bpToPercent(globalStats.observedRateBp) : '—';

  // 막대 차트 데이터
  const LEVEL_LABELS = ['Lv.0→1', 'Lv.1→2', 'Lv.2→3', 'Lv.3→4', 'Lv.4→5'];
  const bars = levelStats
    ? levelStats.map((lv, i) => [
        LEVEL_LABELS[i] ?? `Lv.${lv.beforeLevel}→${lv.beforeLevel + 1}`,
        lv.declaredRateBp / 100, // % 환산
        lv.observedRateBp / 100,
      ])
    : [];

  // 상급 강화 차트 데이터 — 현재 탭 모드의 단계별 현재 적용 확률 그룹
  const advModeNum = advMode === 'safe' ? 0 : 1;
  const latestRates = latestAdvancedRates(rateHistory);
  const advModeRows = advStats ? (advMode === 'safe' ? advStats.safe : advStats.risky) : null;
  const advBars = ADV_LEVEL_LABELS.map((label, i) => ({
    label,
    row: pickCurrentGroup(advModeRows, i, latestRates.get(`${advModeNum}-${i}`), advModeNum === 1),
  }));
  const advDataRows = advBars.map(({ row }) => row).filter((r) => r && !r.noSample);

  // 변경 이력 리스트 (최초 설정 이벤트 제외)
  const rateChanges = rateHistory.filter((h) => !isInitialRateEvent(h));

  // 상급 공정성 요약: 의심 > 표본 부족 > 이상 없음
  const advSuspicious = advDataRows.some((r) => r.fairnessVerdict === 'suspicious');
  const advAllInsufficient =
    advDataRows.length > 0 && advDataRows.every((r) => r.fairnessVerdict === 'insufficient_data');

  return (
    <div className="cf-page">
      <Header address={address} onConnect={onConnect} />

      <div className={styles.inner}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>전체 통계</h1>
          <span className="cf-cap">
            <span style={{ color: 'var(--success)' }}>●</span> 실시간 · on-chain aggregated
          </span>
        </div>

        {loading && <Spinner />}
        {!loading && error && <ErrorMsg msg={error} />}

        {!loading && !error && (
          <>
            {/* ── 요약 카드 ── */}
            <div className={styles.summaryGrid}>
              {summaryCards.map(({ label, value, sub, tone }) => (
                <div key={label} className={styles.summaryCard}>
                  <div className="cf-cap">{label}</div>
                  <div
                    className={styles.summaryValue}
                    style={{ color: tone === 'success' ? 'var(--success)' : 'var(--ink-1)' }}
                  >
                    {value}
                  </div>
                  <div className={styles.summarySub}>{sub}</div>
                </div>
              ))}
            </div>

            {/* ── 차트 영역 ── */}
            <div className={styles.chartGrid}>
              {/* 막대 차트 */}
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <h3 className={styles.cardTitle}>단계별 성공률</h3>
                    <div className="cf-cap" style={{ marginTop: 4 }}>
                      공개 확률 vs 실제 결과
                    </div>
                  </div>
                  <div className={styles.legend}>
                    <span className={styles.legendItem}>
                      <span className={styles.legendDotGray} />
                      <span style={{ color: 'var(--ink-2)' }}>공개 확률</span>
                    </span>
                    <span className={styles.legendItem}>
                      <span className={styles.legendDotEmber} />
                      <span style={{ color: 'var(--ink-2)' }}>실제 결과</span>
                    </span>
                  </div>
                </div>

                <div className={styles.barChart}>
                  {bars.map(([label, expected, actual]) => (
                    <div key={label} className={styles.barGroup}>
                      <div className={styles.bars}>
                        <div className={styles.barExpected} style={{ height: `${expected}%` }} />
                        <div className={styles.barActual} style={{ height: `${actual}%` }} />
                      </div>
                      <div className={styles.barLabel}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* 공정성 요약 */}
                {levelStats &&
                  (() => {
                    const suspicious = levelStats.some((lv) => lv.fairnessVerdict === 'suspicious');
                    return (
                      <div className={styles.verifyNote}>
                        <span style={{ color: suspicious ? 'var(--fail)' : 'var(--success)' }}>
                          {suspicious ? '⚠' : '✓'}
                        </span>
                        <span>
                          {suspicious
                            ? '일부 단계에서 통계적 이상이 감지되었습니다'
                            : '모든 단계에서 실제 결과가 공개 확률 범위 이내 — '}
                          {!suspicious && (
                            <strong style={{ color: 'var(--success)' }}>이상 없음</strong>
                          )}
                        </span>
                      </div>
                    );
                  })()}
              </div>

              {/* 도넛 차트 */}
              <div className={styles.card}>
                <div style={{ marginBottom: 18 }}>
                  <h3 className={styles.cardTitle}>성공 vs 실패</h3>
                  <div className="cf-cap" style={{ marginTop: 4 }}>
                    전체 누적
                  </div>
                </div>

                <div className={styles.donutWrap}>
                  <svg width="220" height="220" viewBox="0 0 220 220">
                    <defs>
                      <linearGradient id="emberGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#ffa85f" />
                        <stop offset="100%" stopColor="#ff7a1a" />
                      </linearGradient>
                    </defs>
                    <circle
                      cx="110"
                      cy="110"
                      r="80"
                      fill="none"
                      stroke="var(--bg-3)"
                      strokeWidth="32"
                    />
                    <circle
                      cx="110"
                      cy="110"
                      r="80"
                      fill="none"
                      stroke="url(#emberGrad)"
                      strokeWidth="32"
                      strokeLinecap="round"
                      strokeDasharray={`${successRate * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
                      transform="rotate(-90 110 110)"
                      style={{ filter: 'drop-shadow(0 0 8px rgba(255,122,26,0.4))' }}
                    />
                    <text
                      x="110"
                      y="106"
                      textAnchor="middle"
                      fontFamily="var(--font)"
                      fontWeight="800"
                      fontSize="32"
                      fill="var(--ink-1)"
                      letterSpacing="-0.03em"
                    >
                      {successPct}%
                    </text>
                    <text
                      x="110"
                      y="128"
                      textAnchor="middle"
                      fontFamily="var(--mono)"
                      fontSize="10"
                      fill="var(--ink-3)"
                      letterSpacing="0.1em"
                    >
                      SUCCESS
                    </text>
                  </svg>
                </div>

                <div className={styles.donutLegend}>
                  <div className={styles.donutLegendItem}>
                    <div className="cf-cap" style={{ color: 'var(--success)' }}>
                      ● 성공
                    </div>
                    <div className={styles.donutLegendValue}>{successCount.toLocaleString()}</div>
                  </div>
                  <div className={styles.donutDivider} />
                  <div className={styles.donutLegendItem}>
                    <div className="cf-cap" style={{ color: 'var(--fail)' }}>
                      ● 실패
                    </div>
                    <div className={styles.donutLegendValue}>{failCount.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── 상급 강화 카드 ── */}
            {advStats && (
              <div className={`${styles.card} ${styles.advCard}`}>
                <div className={styles.cardHeader}>
                  <div>
                    <h3 className={styles.cardTitle}>상급 강화 단계별 통계</h3>
                    <div className="cf-cap" style={{ marginTop: 4 }}>
                      공개 확률 vs 실제 결과 · Lv.5~10
                    </div>
                  </div>
                  <div className={styles.tabs}>
                    <button
                      className={advMode === 'safe' ? styles.tabActive : styles.tab}
                      onClick={() => setAdvMode('safe')}
                    >
                      🛡 쫄보 강화
                    </button>
                    <button
                      className={advMode === 'risky' ? styles.tabActive : styles.tab}
                      onClick={() => setAdvMode('risky')}
                    >
                      🔥 상남자 강화
                    </button>
                  </div>
                </div>

                <div className={styles.legend} style={{ marginBottom: 20 }}>
                  <span className={styles.legendItem}>
                    <span className={styles.legendDotGray} />
                    <span style={{ color: 'var(--ink-2)' }}>성공 공개 확률</span>
                  </span>
                  <span className={styles.legendItem}>
                    <span className={styles.legendDotEmber} />
                    <span style={{ color: 'var(--ink-2)' }}>성공 실제 결과</span>
                  </span>
                  {advMode === 'risky' && (
                    <>
                      <span className={styles.legendItem}>
                        <span className={styles.legendDotRedDim} />
                        <span style={{ color: 'var(--ink-2)' }}>파괴 공개 확률</span>
                      </span>
                      <span className={styles.legendItem}>
                        <span className={styles.legendDotRed} />
                        <span style={{ color: 'var(--ink-2)' }}>파괴 실제 결과</span>
                      </span>
                    </>
                  )}
                </div>

                <div className={styles.barChart}>
                  {advBars.map(({ label, row }) => (
                    <div key={label} className={styles.barGroup}>
                      <div className={styles.bars}>
                        {row ? (
                          <>
                            <div
                              className={styles.barExpected}
                              style={{ height: `${row.declaredSuccessRateBp / 100}%` }}
                            />
                            {!row.noSample && (
                              <div
                                className={styles.barActual}
                                style={{ height: `${row.observedSuccessRateBp / 100}%` }}
                              />
                            )}
                            {advMode === 'risky' && (
                              <>
                                <div
                                  className={styles.barDestroyExpected}
                                  style={{ height: `${row.declaredDestroyRateBp / 100}%` }}
                                />
                                {!row.noSample && (
                                  <div
                                    className={styles.barDestroyActual}
                                    style={{ height: `${row.observedDestroyRateBp / 100}%` }}
                                  />
                                )}
                              </>
                            )}
                          </>
                        ) : (
                          <span className={styles.noData}>데이터 없음</span>
                        )}
                      </div>
                      <div className={styles.barLabel}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* 공정성 요약 */}
                {advDataRows.length === 0 ? (
                  <div className={`${styles.verifyNote} ${styles.noteNeutral}`}>
                    <span>ℹ</span>
                    <span>아직 이 모드의 상급 강화 기록이 없습니다.</span>
                  </div>
                ) : advSuspicious ? (
                  <div className={styles.verifyNote}>
                    <span style={{ color: 'var(--fail)' }}>⚠</span>
                    <span>일부 단계에서 통계적 이상이 감지되었습니다</span>
                  </div>
                ) : advAllInsufficient ? (
                  <div className={`${styles.verifyNote} ${styles.noteNeutral}`}>
                    <span>ℹ</span>
                    <span>
                      표본이 아직 부족해 통계 검정이 유의하지 않습니다 — 데이터 수집 중
                    </span>
                  </div>
                ) : (
                  <div className={styles.verifyNote}>
                    <span style={{ color: 'var(--success)' }}>✓</span>
                    <span>
                      검정 가능한 단계에서 실제 결과가 공개 확률 범위 이내 —{' '}
                      <strong style={{ color: 'var(--success)' }}>이상 없음</strong>
                    </span>
                  </div>
                )}

                {/* ── 확률 변경 이력 ── */}
                {rateChanges.length > 0 && (
                  <div className={styles.historySection}>
                    <div className="cf-cap" style={{ marginBottom: 6 }}>
                      확률 변경 이력
                    </div>
                    {rateChanges.map((h) => {
                      const isRisky = h.mode === 1;
                      const prev = findGroup(
                        isRisky ? advStats?.risky : advStats?.safe,
                        h.extraLevel,
                        h.oldSuccessRateBp,
                        h.oldDestroyRateBp,
                        isRisky
                      );
                      return (
                        <div key={`${h.txHash}-${h.logIndex}`} className={styles.historyItem}>
                          <div className={styles.historyMeta}>
                            {formatDateTime(h.onChainTimestamp)} · {isRisky ? '🔥 상남자' : '🛡 쫄보'}{' '}
                            {ADV_LEVEL_LABELS[h.extraLevel] ?? `extraLevel ${h.extraLevel}`}
                          </div>
                          <div className={styles.historyChange}>
                            성공 {h.oldSuccessRateBp / 100}% → {h.newSuccessRateBp / 100}%
                            {isRisky &&
                              ` · 파괴 ${h.oldDestroyRateBp / 100}% → ${h.newDestroyRateBp / 100}%`}
                          </div>
                          <div className={styles.historyPrev}>
                            {prev
                              ? `변경 전 실측: ${advSampleSize(prev)}건 · 성공 ${bpToPercent(prev.observedSuccessRateBp)}%` +
                                (isRisky && prev.observedDestroyRateBp != null
                                  ? ` · 파괴 ${bpToPercent(prev.observedDestroyRateBp)}%`
                                  : '')
                              : '변경 전 실측: 표본 없음'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
