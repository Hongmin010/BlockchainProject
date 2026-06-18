import { useEffect, useCallback } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header, Badge, Button, StageBar } from '../components';
import { WalletModal } from '../components';
import { useForge } from '../hooks/useForge';
import {
  useAdvancedForge,
  AdvancedMode,
  MAX_EXTRA_LEVEL,
  MAX_TOTAL_LEVEL,
  fetchDeclaredAdvancedRates,
} from '../hooks/useAdvancedForge';
import {
  fetchRecentAttempts,
  fetchProbabilityHistory,
  fetchMerkleProof,
  fetchUserStats,
  fetchMerkleItems,
  fetchAdvancedRecentAttempts,
} from '../api/api';
import CatList from './Game/CatList';
import ForgeStage from './Game/ForgeStage';
import ProbabilityCard from './Game/ProbabilityCard';
import RecentAttemptsCard from './Game/RecentAttemptsCard';
import { ADV_RESULT_INFO } from './Game/constants';
import styles from './Game.module.css';

// 확률표 (컨트랙트 기본값 — API 로드 전 폴백)
const DEFAULT_PROB_TABLE = [
  { stage: 'Lv.0 → Lv.1', prob: 90 },
  { stage: 'Lv.1 → Lv.2', prob: 70 },
  { stage: 'Lv.2 → Lv.3', prob: 50 },
  { stage: 'Lv.3 → Lv.4', prob: 30 },
  { stage: 'Lv.4 → Lv.5', prob: 10 },
];

// 상급 확률표: extraLevel 0~14 (Lv.5→6 ... Lv.19→20), 총 15단계 (API 로드 전 폴백)
const DEFAULT_ADV_PROB_TABLE = Array.from({ length: MAX_EXTRA_LEVEL }, (_, i) => ({
  stage: `Lv.${5 + i} → Lv.${6 + i}`,
  successProb: null,
  destroyProb: null,
}));

const ENHANCEMENT_TYPE = 0;

export default function Game({ address, onConnect, wallet }) {
  const navigate = useNavigate();

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

  // ── 아이템 목록 상태 ─────────────────────────────────────────
  const [userItems, setUserItems] = useState([]);
  const [merkleItemIds, setMerkleItemIds] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(1);
  // displayLevel(훅 라이브 레벨)이 실제로 반영하는 아이템 id.
  // 선택 전환 직후엔 refreshState가 아직 안 끝나 displayLevel이 직전 아이템 값이므로,
  // 이 값이 selectedItemId와 일치할 때만 목록 썸네일을 라이브 레벨로 덮어쓴다.
  const [liveLevelItemId, setLiveLevelItemId] = useState(null);

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
    let cancelled = false;
    setLiveLevelItemId(null); // 새 선택 → 라이브 레벨 갱신 전까지 덮어쓰기 보류
    Promise.all([refreshState(selectedItemId), advRefreshState(selectedItemId)]).then(() => {
      if (!cancelled) setLiveLevelItemId(selectedItemId);
    });
    return () => {
      cancelled = true;
    };
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

    // 상급 확률표: 선언 확률을 백엔드 거치지 않고 컨트랙트에서 직접 읽는다.
    // (투명성 주제 — 화면의 숫자가 곧 온체인 값. 누구나 컨트랙트로 검증 가능)
    fetchDeclaredAdvancedRates()
      .then(({ safe, risky }) => {
        const fill = (rates) =>
          DEFAULT_ADV_PROB_TABLE.map((row, i) => ({
            ...row,
            successProb: rates[i].successProb,
            destroyProb: rates[i].destroyProb,
          }));
        setAdvSafeTable(fill(safe));
        setAdvRiskyTable(fill(risky));
      })
      .catch((err) => console.error('[Game] 상급 선언 확률 로드 실패:', err));

    // 최근 강화 결과: 전체 사용자(글로벌) 피드. '전체 보기'는 대시보드로 이동.
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

  // 목록은 인덱서 DB(fetchUserStats) 기반이라 인덱싱이 밀리면 stale함.
  // 현재 선택된 고양이는 컨트랙트 직접 조회값(displayLevel)이 있으므로 그 라이브 레벨로 덮어써
  // 무대/현재 단계와 목록 썸네일 레벨이 어긋나지 않게 한다.
  // 단, 라이브 레벨이 선택 아이템 것으로 확정됐을 때만(liveLevelItemId 일치) 덮어쓴다.
  // 선택 전환 직후엔 displayLevel이 직전 아이템 값이라 덮어쓰면 썸네일이 깜빡인다.
  const displayItems = userItems.map((it) =>
    Number(it.itemId) === selectedItemId && liveLevelItemId === selectedItemId
      ? { ...it, level: displayLevel, totalLevel: displayLevel }
      : it
  );

  // ── 파생 값 ──────────────────────────────────────────────────
  const isForging = isAdvancedMode
    ? advStatus === 'waiting_tx' || advStatus === 'waiting_vrf'
    : status === 'waiting_tx' || status === 'waiting_vrf';

  const currentProb = !isAdvancedMode ? (probTable[level]?.prob ?? 0) : null;

  return (
    <div className={styles.page}>
      <Header address={address} onConnect={onConnect} />

      <div className={styles.grid}>
        {/* ── 고양이 강화 섹션 ── */}
        <div className={styles.leftCard}>
          {/* 고양이 아이템 목록 */}
          <CatList
            items={displayItems}
            selectedItemId={selectedItemId}
            onSelect={setSelectedItemId}
            loading={itemsLoading}
            error={itemsError}
          />

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
                  {displayLevel < MAX_TOTAL_LEVEL ? `Lv. ${displayLevel + 1}` : 'MAX'}
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
                <div className={`${styles.stageBarSection} ${styles.stageBarSectionAdvanced}`}>
                  <span className={`${styles.stageBarLabel} ${styles.stageBarLabelAdvanced}`}>상급</span>
                  <StageBar current={extraLevel} max={MAX_EXTRA_LEVEL} variant="advanced" compact labelOffset={5} />
                </div>
              </div>
            )}
          </div>

          {/* 고양이 무대 */}
          <ForgeStage
            isAdvancedMode={isAdvancedMode}
            displayLevel={displayLevel}
            isForging={isForging}
            lastResult={lastResult}
            advLastResult={advLastResult}
          />

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
            ) : totalLevel >= MAX_TOTAL_LEVEL ? (
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
          <ProbabilityCard
            isAdvancedMode={isAdvancedMode}
            advMode={advMode}
            onModeChange={setAdvMode}
            probTable={probTable}
            advProbTable={advProbTable}
            level={level}
            extraLevel={extraLevel}
            isGuaranteed={isGuaranteed}
            isRiskyBlocked={isRiskyBlocked}
            safeDropStreak={safeDropStreak}
          />

          {/* 최근 강화 결과 */}
          <RecentAttemptsCard
            attempts={recentAttempts}
            advAttempts={recentAdvAttempts}
            loading={recentLoading}
          />
        </div>
      </div>
    </div>
  );
}
