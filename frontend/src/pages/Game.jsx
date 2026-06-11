import { useEffect, useCallback } from 'react';
import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Header, Badge, Button, StageBar, TxHash } from '../components';
import { WalletModal } from '../components';
import { useForge } from '../hooks/useForge';
import { useAdvancedForge, AdvancedMode, AdvancedResultType } from '../hooks/useAdvancedForge';
import {
  fetchRecentAttempts,
  fetchProbabilityHistory,
  fetchMerkleProof,
  fetchUserStats,
  fetchMerkleItems,
  fetchAchievements,
  fetchAdvancedStats,
  fetchAdvancedRecentAttempts,
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

const DEFAULT_ADV_PROB_TABLE = [
  { stage: 'Lv.5 → Lv.6', successProb: null, destroyProb: null },
  { stage: 'Lv.6 → Lv.7', successProb: null, destroyProb: null },
  { stage: 'Lv.7 → Lv.8', successProb: null, destroyProb: null },
  { stage: 'Lv.8 → Lv.9', successProb: null, destroyProb: null },
  { stage: 'Lv.9 → Lv.10', successProb: null, destroyProb: null },
];

const CAT_EMOJIS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

const ENHANCEMENT_TYPE = 0;

// 상급 결과 타입별 표시 정보
const ADV_RESULT_INFO = {
  [AdvancedResultType.FailKeep]:      { label: '✕ 실패 (유지)',  logStyle: 'logFail',       badgeStyle: 'resultFail' },
  [AdvancedResultType.Success]:       { label: '✓ 성공!',        logStyle: 'logSuccess',    badgeStyle: 'resultSuccess' },
  [AdvancedResultType.SafeDowngrade]: { label: '↓ 단계 하락',    logStyle: 'logDowngrade',  badgeStyle: 'resultDowngrade' },
  [AdvancedResultType.Destroyed]:     { label: '💥 파괴!',        logStyle: 'logDestroyed',  badgeStyle: 'resultDestroyed' },
  [AdvancedResultType.Guaranteed]:    { label: '🌟 보장 성공!',   logStyle: 'logGuaranteed', badgeStyle: 'resultGuaranteed' },
};

export default function Game({ address, onConnect, wallet }) {
  const navigate = useNavigate();
  const stageRef = useRef(null);

  // ── useForge 훅 (일반 강화 0~5단계) ─────────────────────────
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

  // ── useAdvancedForge 훅 (상급 강화 5~10단계) ─────────────────
  const {
    extraLevel,
    totalLevel,
    safeDropStreak,
    isGuaranteed,
    isRiskyBlocked,
    isPending: advPending,
    status: advStatus,
    lastResult: advLastResult,
    error: advError,
    forge: advForge,
    refreshState: advRefreshState,
  } = useAdvancedForge({
    signer: wallet?.signer ?? null,
    provider: wallet?.provider ?? null,
    address,
  });

  const isAdvancedMode = level >= 5;
  const displayLevel = isAdvancedMode ? totalLevel : level;

  // ── 상급 강화 모드 선택 (Safe/Risky) ─────────────────────────
  const [advMode, setAdvMode] = useState(AdvancedMode.Safe);

  // Risky 차단 시 Safe로 자동 전환
  useEffect(() => {
    if (isRiskyBlocked) setAdvMode(AdvancedMode.Safe);
  }, [isRiskyBlocked]);

  // ── 업적 상태 ────────────────────────────────────────────────
  const [achievement, setAchievement] = useState(null);

  useEffect(() => {
    if (!address) return;
    fetchAchievements(address)
      .then((data) => {
        const ach = data.achievements?.[0];
        setAchievement({
          claimed: ach?.claimed ?? false,
          label: ach?.label ?? 'Lv.10 달성',
          description: ach?.description ?? '최대 레벨 달성 시 자동 지급',
        });
      })
      .catch(() => {});
  }, [address]);

  // ── 아이템 목록 상태 ─────────────────────────────────────────
  const [userItems, setUserItems] = useState([]);
  const [merkleItemIds, setMerkleItemIds] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(1);

  // ── 상급 해금 알림 ────────────────────────────────────────────
  const [showAdvancedUnlock, setShowAdvancedUnlock] = useState(false);

  useEffect(() => {
    if (lastResult?.afterLevel === 5) {
      setShowAdvancedUnlock(true);
      const t = setTimeout(() => setShowAdvancedUnlock(false), 4000);
      return () => clearTimeout(t);
    }
  }, [lastResult]);

  // ── Merkle proof 상태 ────────────────────────────────────────
  const [isFetchingProof, setIsFetchingProof] = useState(false);
  const [proofError, setProofError] = useState(null);

  // ── 최근 강화 결과 ────────────────────────────────────────────
  const [recentAttempts, setRecentAttempts] = useState([]);
  const [recentAdvAttempts, setRecentAdvAttempts] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);

  // ── 확률표 ───────────────────────────────────────────────────
  const [probTable, setProbTable] = useState(DEFAULT_PROB_TABLE);
  const [advSafeTable, setAdvSafeTable] = useState(DEFAULT_ADV_PROB_TABLE);
  const [advRiskyTable, setAdvRiskyTable] = useState(DEFAULT_ADV_PROB_TABLE);

  const advProbTable = advMode === AdvancedMode.Risky ? advRiskyTable : advSafeTable;

  // merkle itemId 목록 + stats 레벨 데이터를 병합해서 아이템 배열로 만드는 헬퍼
  const mergeItems = useCallback((itemIds, statsItems) => {
    const statsMap = new Map(statsItems.map((it) => [String(it.itemId), it]));
    return itemIds.map((id) => statsMap.get(String(id)) ?? { itemId: String(id), level: 0, totalLevel: 0 });
  }, []);

  // 지갑 연결 시 아이템 목록 로드 (merkle 전체 목록 + stats 레벨 병합)
  useEffect(() => {
    if (!address) return;
    setItemsLoading(true);
    setItemsError(false);
    Promise.all([fetchMerkleItems(address), fetchUserStats(address)])
      .then(([merkleData, statsData]) => {
        const ids = merkleData.itemIds ?? [];
        setMerkleItemIds(ids);
        const merged = mergeItems(ids, statsData.items ?? []);
        setUserItems(merged);
        if (merged.length > 0 && !merged.find((it) => Number(it.itemId) === selectedItemId)) {
          setSelectedItemId(Number(merged[0].itemId));
        }
        setItemsLoading(false);
      })
      .catch(() => {
        setItemsError(true);
        setItemsLoading(false);
      });
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  // 선택 아이템 변경 시 훅 상태 동기화
  useEffect(() => {
    refreshState(selectedItemId);
    advRefreshState(selectedItemId);
  }, [selectedItemId, refreshState, advRefreshState]);

  // 마운트 시 확률표 + 최근 결과 로드
  useEffect(() => {
    fetchProbabilityHistory()
      .then(({ history }) => {
        if (!history || history.length === 0) return;
        const latestByLevel = {};
        [...history].reverse().forEach((h) => {
          if (!(h.level in latestByLevel)) latestByLevel[h.level] = h.newSuccessRateBp;
        });
        setProbTable(
          DEFAULT_PROB_TABLE.map((row, i) => ({
            ...row,
            prob: i in latestByLevel ? latestByLevel[i] / 100 : row.prob,
          }))
        );
      })
      .catch(() => {});

    fetchAdvancedStats()
      .then(({ safe, risky }) => {
        if (safe?.length > 0) {
          setAdvSafeTable(
            DEFAULT_ADV_PROB_TABLE.map((row, i) => {
              const match = safe.find((s) => s.extraLevel === i);
              return match ? { ...row, successProb: match.declaredSuccessRateBp / 100 } : row;
            })
          );
        }
        if (risky?.length > 0) {
          setAdvRiskyTable(
            DEFAULT_ADV_PROB_TABLE.map((row, i) => {
              const match = risky.find((r) => r.extraLevel === i);
              return match
                ? {
                    ...row,
                    successProb: match.declaredSuccessRateBp / 100,
                    destroyProb: match.declaredDestroyRateBp / 100,
                  }
                : row;
            })
          );
        }
      })
      .catch(() => {});

    Promise.all([
      fetchRecentAttempts(8),
      fetchAdvancedRecentAttempts(8),
    ])
      .then(([base, adv]) => {
        setRecentAttempts(base.attempts ?? []);
        setRecentAdvAttempts(adv.attempts ?? []);
        setRecentLoading(false);
      })
      .catch(() => setRecentLoading(false));
  }, []);

  // 일반 강화 완료 시 갱신
  useEffect(() => {
    if (status !== 'done' || !address) return;
    fetchRecentAttempts(8)
      .then((data) => setRecentAttempts(data.attempts ?? []))
      .catch(() => {});
    fetchUserStats(address)
      .then((data) => setUserItems(mergeItems(merkleItemIds, data.items ?? [])))
      .catch(() => {});
  }, [status, address]); // eslint-disable-line react-hooks/exhaustive-deps

  // 상급 강화 완료 시 갱신
  useEffect(() => {
    if (advStatus !== 'done' || !address || !advLastResult) return;

    // 인덱서가 블록을 처리하기 전에 이벤트가 먼저 도착 → 즉시 옵티미스틱 항목 추가
    const optimistic = {
      attemptId: null,
      requestedTxHash: advLastResult.txHash || null,
      beforeTotalLevel: advLastResult.beforeTotalLevel,
      afterTotalLevel: advLastResult.afterTotalLevel,
      resultType: advLastResult.resultType,
      modeLabel: advLastResult.mode === 1 ? 'risky' : 'safe',
      requestedAt: new Date().toISOString(),
    };
    setRecentAdvAttempts((prev) => [optimistic, ...prev.slice(0, 7)]);

    // 인덱서 처리 대기 후 실제 DB 데이터로 교체 (CONFIRMATION_BLOCKS + 폴링 주기)
    const timer = setTimeout(() => {
      fetchAdvancedRecentAttempts(8)
        .then((data) => { if (data.attempts?.length > 0) setRecentAdvAttempts(data.attempts); })
        .catch(() => {});
      fetchUserStats(address)
        .then((data) => setUserItems(mergeItems(merkleItemIds, data.items ?? [])))
        .catch(() => {});
      fetchAchievements(address)
        .then((data) => {
          const ach = data.achievements?.[0];
          if (ach) setAchievement({ claimed: ach.claimed, label: ach.label, description: ach.description });
        })
        .catch(() => {});
    }, 20_000);
    return () => clearTimeout(timer);
  }, [advStatus, address, advLastResult]);

  // ── 강화 버튼 핸들러 ─────────────────────────────────────────
  const handleForge = useCallback(async (mode = AdvancedMode.Safe) => {
    if (isAdvancedMode) setAdvMode(mode); // 확률표 탭도 누른 모드로 동기화
    setProofError(null);
    let proof = [];

    setIsFetchingProof(true);
    try {
      const result = await fetchMerkleProof(address, selectedItemId, ENHANCEMENT_TYPE);
      proof = result.proof;
    } catch (err) {
      setProofError(err.message ?? '등록되지 않은 사용자입니다. 운영자에게 등록을 요청해주세요.');
      setIsFetchingProof(false);
      return;
    }
    setIsFetchingProof(false);

    if (isAdvancedMode) {
      advForge(selectedItemId, mode, proof);
    } else {
      forge(selectedItemId, ENHANCEMENT_TYPE, proof);
    }
  }, [isAdvancedMode, address, selectedItemId, forge, advForge]);

  // ── 파티클 애니메이션 ─────────────────────────────────────────
  const spawnParticles = useCallback((resultTypeOrBool) => {
    const stage = stageRef.current;
    if (!stage) return;
    let colors, count;
    if (resultTypeOrBool === AdvancedResultType.Destroyed) {
      colors = ['#ff3300', '#ff6600', '#cc0000']; count = 14;
    } else if (resultTypeOrBool === AdvancedResultType.Guaranteed) {
      colors = ['#ffd700', '#ffaa00', '#fff080']; count = 12;
    } else if (resultTypeOrBool === AdvancedResultType.SafeDowngrade) {
      colors = ['#e8623c', '#f08060']; count = 4;
    } else if (resultTypeOrBool === AdvancedResultType.Success || resultTypeOrBool === true) {
      colors = ['#5fc37a', '#a8f0bc']; count = 8;
    } else {
      colors = ['#e8623c', '#f0a090']; count = 4;
    }
    for (let i = 0; i < count; i++) {
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

  useEffect(() => {
    if (advLastResult) spawnParticles(advLastResult.resultType);
  }, [advLastResult, spawnParticles]);

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

  const displayItems = userItems;

  // ── 파생 값 ──────────────────────────────────────────────────
  const isForging = isAdvancedMode
    ? advStatus === 'waiting_tx' || advStatus === 'waiting_vrf'
    : status === 'waiting_tx' || status === 'waiting_vrf';

  const currentProb = !isAdvancedMode ? (probTable[level]?.prob ?? 0) : null;

  const ADV_BADGE = { 0: '실패', 1: '성공', 2: '하락', 3: '파괴', 4: '보장' };

  const recentRows = [
    ...recentAttempts.map((a) => ({
      tx: a.requestedTxHash ? shortenTx(a.requestedTxHash) : `#${a.attemptId}`,
      stage: `Lv.${a.beforeLevel}`,
      success: a.success,
      isAdvanced: false,
      sortKey: a.requestedAt,
      time: formatDateTime(a.requestedAt),
    })),
    ...recentAdvAttempts.map((a) => ({
      tx: a.requestedTxHash ? shortenTx(a.requestedTxHash) : `#${a.attemptId}`,
      stage: `Lv.${a.beforeTotalLevel}`,
      success: a.resultType === 1 || a.resultType === 4,
      isAdvanced: true,
      modeLabel: a.modeLabel,
      resultType: a.resultType,
      sortKey: a.requestedAt,
      time: formatDateTime(a.requestedAt),
    })),
  ]
    .sort((a, b) => new Date(b.sortKey) - new Date(a.sortKey))
    .slice(0, 8);

  // 스테이지 이펙트 상태
  let stageState = null;
  if (isAdvancedMode && advLastResult) {
    if (advLastResult.resultType === AdvancedResultType.Destroyed) stageState = 'destroyed';
    else if (advLastResult.success) stageState = 'success';
    else stageState = 'fail';
  } else if (!isAdvancedMode && lastResult) {
    stageState = lastResult.success ? 'success' : 'fail';
  }

  const advResultInfo = advLastResult != null ? ADV_RESULT_INFO[advLastResult.resultType] : null;

  return (
    <div className={styles.page}>
      <Header address={address} onConnect={onConnect} />

      <div className={styles.grid}>
        {/* ── 고양이 강화 섹션 ── */}
        <div className={styles.leftCard}>
          {/* 고양이 아이템 목록 */}
          {itemsLoading && (
            <div className={styles.catListEmpty}>고양이 목록 불러오는 중…</div>
          )}
          {!itemsLoading && displayItems.length > 0 && (
            <div className={styles.catList}>
              {displayItems.map((item) => {
                const iid = Number(item.itemId);
                const isSelected = iid === selectedItemId;
                return (
                  <button
                    key={iid}
                    className={`${styles.catListItem} ${isSelected ? styles.catListItemSelected : ''}`}
                    onClick={() => setSelectedItemId(iid)}
                  >
                    <span className={styles.catListEmoji}>
                      {CAT_EMOJIS[Math.min(item.totalLevel ?? item.level, CAT_EMOJIS.length - 1)]}
                    </span>
                    <span className={`${styles.catListMeta} ${isSelected ? styles.catListMetaSelected : ''}`}>
                      #{iid} · Lv.{item.totalLevel ?? item.level}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {!itemsLoading && itemsError && (
            <div className={styles.catListEmpty}>⚠ 서버 연결 실패 — 백엔드 서버를 확인해주세요</div>
          )}
          {!itemsLoading && !itemsError && displayItems.length === 0 && (
            <div className={styles.catListEmpty}>보유 고양이 없음 — NFT 민팅 후 이용해주세요</div>
          )}

          {/* 레벨 표시 */}
          <div className={styles.levelRow}>
            <div>
              <div className="cf-cap" style={{ marginBottom: 6 }}>
                현재 단계{isAdvancedMode && <span className={styles.advancedTag}>상급</span>}
              </div>
              <div className={styles.levelDisplay}>
                <span className={styles.levelCurrent}>Lv. {displayLevel}</span>
                <span style={{ color: 'var(--ink-3)' }}>→</span>
                <span className={isAdvancedMode ? styles.levelNextAdvanced : styles.levelNext}>
                  {displayLevel < 10 ? `Lv. ${displayLevel + 1}` : 'MAX'}
                </span>
              </div>
            </div>
            <Badge>
              <span style={{ color: 'var(--ink-3)' }}>성공률</span>
              {currentProb !== null ? (
                <span style={{ color: 'var(--ember-300)', fontWeight: 700 }}>{currentProb}%</span>
              ) : (
                <span style={{ color: '#9b7de0', fontWeight: 700 }}>
                  {advProbTable[extraLevel]?.successProb != null
                    ? `${advProbTable[extraLevel].successProb}%`
                    : '—'}
                </span>
              )}
            </Badge>
          </div>

          {/* 단계 바 */}
          <div style={{ marginBottom: 24 }}>
            {!isAdvancedMode ? (
              <StageBar current={level} max={5} />
            ) : (
              <div className={styles.stageBarGroup}>
                <div className={styles.stageBarSection}>
                  <span className={styles.stageBarLabel}>일반</span>
                  <StageBar current={5} max={5} />
                </div>
                <span className={styles.stageBarArrow}>›</span>
                <div className={styles.stageBarSection}>
                  <span className={`${styles.stageBarLabel} ${styles.stageBarLabelAdvanced}`}>상급</span>
                  <StageBar current={extraLevel} max={5} variant="advanced" />
                </div>
              </div>
            )}
          </div>

          {/* 고양이 무대 */}
          <div
            ref={stageRef}
            className={`${styles.stage}
              ${stageState === 'success' ? styles.stageSuccess : ''}
              ${stageState === 'fail' ? styles.stageFail : ''}
              ${stageState === 'destroyed' ? styles.stageDestroyed : ''}`}
          >
            <div className={styles.checker} />

            {stageState && (
              <div
                className={`${styles.resultBadge} ${
                  isAdvancedMode && advResultInfo
                    ? styles[advResultInfo.badgeStyle]
                    : stageState === 'success'
                    ? styles.resultSuccess
                    : styles.resultFail
                }`}
              >
                {isAdvancedMode && advResultInfo
                  ? advResultInfo.label
                  : stageState === 'success'
                  ? '✓ 성공!'
                  : '✕ 실패'}
              </div>
            )}

            <div
              className={`${styles.cat}
                ${stageState === 'success' ? styles.catBounce : ''}
                ${stageState === 'fail' || stageState === 'destroyed' ? styles.catShake : ''}
                ${isForging && !stageState ? styles.catWait : ''}`}
            >
              {CAT_EMOJIS[Math.min(displayLevel, CAT_EMOJIS.length - 1)]}
            </div>

            <div className={`${styles.lvBadge} ${isAdvancedMode ? styles.lvBadgeAdvanced : ''}`}>
              LV. {displayLevel}
            </div>
          </div>

          {/* 상급 강화 해금 알림 */}
          {showAdvancedUnlock && (
            <div className={styles.advancedUnlock}>
              🔓 상급 강화 해금! 이제 Lv.10까지 강화할 수 있어요
            </div>
          )}

          {/* 보장 / 스트릭 / 차단 배너 */}
          {isAdvancedMode && advMode === AdvancedMode.Safe && isGuaranteed && (
            <div className={styles.guaranteedBanner}>🌟 다음 쫄보 강화 보장 발동!</div>
          )}
          {isAdvancedMode && advMode === AdvancedMode.Safe && !isGuaranteed && safeDropStreak > 0 && (
            <div className={styles.safeStreakBanner}>
              연속 하락 {safeDropStreak}회 · {2 - safeDropStreak}회 더 하락 시 보장
            </div>
          )}
          {isAdvancedMode && isRiskyBlocked && (
            <div className={styles.riskyBlockedBanner}>🔒 보장 쫄보 강화를 먼저 사용해야 합니다</div>
          )}

          {/* VRF 대기 안내 */}
          {isForging && (
            <div style={{ textAlign: 'center', padding: '8px 0', color: 'var(--ink-3)', fontSize: 13 }}>
              ⏳ Chainlink VRF 결과 대기 중… (약 10–30초)
            </div>
          )}

          {/* 오류 */}
          {(forgeError || advError) && (
            <div style={{ color: 'var(--fail)', fontSize: 13, marginTop: 4 }}>
              ⚠ {forgeError || advError}
            </div>
          )}
          {proofError && (
            <div style={{ color: 'var(--fail)', fontSize: 13, marginTop: 4 }}>🔒 {proofError}</div>
          )}

          {/* 강화 로그 */}
          {(lastResult || advLastResult) && (
            <div className={styles.logList}>
              <div className={styles.logItem}>
                {!isAdvancedMode && lastResult && (
                  <>
                    <span className={styles.logStage}>
                      Lv.{lastResult.beforeLevel}→{lastResult.afterLevel}
                    </span>
                    <span className={lastResult.success ? styles.logSuccess : styles.logFail}>
                      {lastResult.success ? '✓ 성공' : '✕ 실패'}
                    </span>
                  </>
                )}
                {isAdvancedMode && advLastResult && (() => {
                  const info = ADV_RESULT_INFO[advLastResult.resultType];
                  return (
                    <>
                      <span className={styles.logStage}>
                        {advLastResult.mode === AdvancedMode.Risky ? '상남자' : '쫄보'}{' '}
                        Lv.{advLastResult.beforeTotalLevel}→{advLastResult.afterTotalLevel}
                      </span>
                      <span className={styles[info?.logStyle ?? 'logFail']}>
                        {info?.label ?? '—'}
                      </span>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* 액션 버튼 */}
          <div className={styles.actions}>
            {!isAdvancedMode ? (
              <Button
                variant="primary"
                size="xl"
                onClick={() => handleForge()}
                disabled={isForging || isFetchingProof || isPending || level >= 5}
                loading={isForging || isFetchingProof}
                style={{ flex: '1 1 auto' }}
              >
                {isPending || isForging
                  ? '⏳ 결과 대기 중…'
                  : isFetchingProof
                  ? '🔑 등록 확인 중…'
                  : '⚒ 강화 시도하기'}
              </Button>
            ) : totalLevel >= 10 ? (
              <Button variant="primary" size="xl" disabled style={{ flex: '1 1 auto' }}>
                🎉 최고 레벨!
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  size="xl"
                  className={styles.btnSafe}
                  onClick={() => handleForge(AdvancedMode.Safe)}
                  disabled={isForging || isFetchingProof || advPending}
                  loading={(isForging || isFetchingProof) && advMode === AdvancedMode.Safe}
                  style={{ flex: '1 1 auto' }}
                >
                  {(isForging || advPending) && advMode === AdvancedMode.Safe
                    ? '⏳ 결과 대기 중…'
                    : isFetchingProof && advMode === AdvancedMode.Safe
                    ? '🔑 등록 확인 중…'
                    : isGuaranteed
                    ? '🌟 보장 강화'
                    : '🛡 쫄보 강화'}
                </Button>
                <Button
                  variant="primary"
                  size="xl"
                  onClick={() => handleForge(AdvancedMode.Risky)}
                  disabled={isForging || isFetchingProof || advPending || isRiskyBlocked}
                  loading={(isForging || isFetchingProof) && advMode === AdvancedMode.Risky}
                  style={{ flex: '1 1 auto' }}
                >
                  {(isForging || advPending) && advMode === AdvancedMode.Risky
                    ? '⏳ 결과 대기 중…'
                    : isFetchingProof && advMode === AdvancedMode.Risky
                    ? '🔑 등록 확인 중…'
                    : isRiskyBlocked
                    ? '🔒 상남자 강화'
                    : '⚔ 상남자 강화'}
                </Button>
              </>
            )}
          </div>
          <div className={styles.gasNote}>
            <span>⛽</span>
            <span>Base Sepolia · VRF 난수로 공정 판정 · 결과는 블록체인에 기록</span>
          </div>
        </div>

        {/* ── 확률 & 기록 섹션 ── */}
        <div className={styles.rightCol}>
          {/* 확률표 카드 */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>
                {isAdvancedMode ? '상급 강화 확률표' : '단계별 확률표'}
              </h3>
              <span className="cf-cap">on-chain published</span>
            </div>

            {/* 상급 강화 탭 */}
            {isAdvancedMode && (
              <>
                <div className={styles.advModeTabs}>
                  <button
                    className={`${styles.advModeTab} ${advMode === AdvancedMode.Safe ? styles.advModeTabActiveSafe : ''}`}
                    onClick={() => setAdvMode(AdvancedMode.Safe)}
                  >
                    쫄보 강화
                    {isGuaranteed && <span className={styles.guaranteedDot}>🌟</span>}
                  </button>
                  <button
                    className={`${styles.advModeTab} ${advMode === AdvancedMode.Risky ? styles.advModeTabActiveRisky : ''} ${isRiskyBlocked ? styles.advModeTabBlocked : ''}`}
                    onClick={() => !isRiskyBlocked && setAdvMode(AdvancedMode.Risky)}
                    disabled={isRiskyBlocked}
                  >
                    상남자 강화{isRiskyBlocked ? ' 🔒' : ''}
                  </button>
                </div>

                {advMode === AdvancedMode.Safe && (isGuaranteed ? (
                  <div className={styles.guaranteedIndicator}>🌟 다음 강화 보장 발동!</div>
                ) : safeDropStreak > 0 ? (
                  <div className={styles.streakIndicator}>
                    연속 하락 {safeDropStreak}회 · {2 - safeDropStreak}회 더 하락 시 보장
                  </div>
                ) : null)}
              </>
            )}

            {/* 확률표 */}
            <div className={styles.probList}>
              {isAdvancedMode
                ? advProbTable.map(({ stage, successProb, destroyProb }, i) => {
                    const active = i === extraLevel;
                    return (
                      <div
                        key={stage}
                        className={`${styles.probRow} ${active ? styles.probRowActiveAdv : ''} ${advMode === AdvancedMode.Risky ? styles.probRowRisky : ''}`}
                      >
                        <span className={`${styles.probStage} ${active ? styles.probStageActiveAdv : ''}`}>
                          {stage}
                        </span>
                        <div className={styles.probBarWrap}>
                          <div
                            className={`${styles.probBarFill} ${active ? styles.probBarActiveAdv : ''}`}
                            style={{ width: `${successProb ?? 0}%` }}
                          />
                        </div>
                        <span className={`${styles.probValue} ${active ? styles.probValueActiveAdv : ''}`}>
                          {successProb !== null ? `${successProb}%` : '—'}
                        </span>
                        {advMode === AdvancedMode.Risky && (
                          <span className={styles.destroyRate}>
                            💥 {destroyProb !== null ? `${destroyProb}%` : '—'}
                          </span>
                        )}
                      </div>
                    );
                  })
                : probTable.map(({ stage, prob }, i) => {
                    const active = i === level;
                    return (
                      <div key={stage} className={`${styles.probRow} ${active ? styles.probRowActive : ''}`}>
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

            {isAdvancedMode && (
              <div className={styles.advModeNote}>
                {advMode === AdvancedMode.Safe
                  ? '실패 시 단계 -1 하락 · 2회 연속 하락 시 보장 발동'
                  : '실패 시 Lv.5로 리셋 위험 — 고위험 고수익'}
              </div>
            )}
          </div>

          {/* 업적 카드 */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>업적</h3>
              <span className="cf-cap">on-chain NFT</span>
            </div>
            <div className={styles.achievementItem}>
              <div className={styles.achievementIcon}>🏆</div>
              <div className={styles.achievementBody}>
                <div className={styles.achievementLabel}>
                  {achievement?.label ?? 'Lv.10 달성'}
                </div>
                <div className={styles.achievementDesc}>
                  {achievement?.description ?? '최대 레벨 달성 시 자동 지급'}
                </div>
              </div>
              {achievement?.claimed ? (
                <span className={styles.achievementBadgeClaimed}>획득</span>
              ) : (
                <span className={styles.achievementBadgePending}>미획득</span>
              )}
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
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--ink-3)', fontSize: 13 }}>
                  불러오는 중…
                </div>
              ) : recentRows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--ink-3)', fontSize: 13 }}>
                  기록 없음
                </div>
              ) : (
                recentRows.map(({ tx, stage, success, isAdvanced, modeLabel, resultType, time }, idx) => (
                  <div key={idx} className={styles.recentRow}>
                    <div className={styles.recentInfo}>
                      <TxHash hash={tx} shorten={false} />
                      <span className={styles.recentSub}>
                        {stage} · {time}
                        {isAdvanced && (
                          <span className={modeLabel === 'risky' ? styles.recentTagRisky : styles.recentTagSafe}>
                            {modeLabel === 'risky' ? ' 상남자' : ' 쫄보'}
                          </span>
                        )}
                      </span>
                    </div>
                    <Badge variant={success ? 'success' : 'fail'} dot>
                      {isAdvanced ? (ADV_BADGE[resultType] ?? '—') : success ? '성공' : '실패'}
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
