import { useEffect, useCallback } from 'react';
import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Header, Badge, Button, StageBar, TxHash } from '../components';
import { WalletModal } from '../components';
import { useForge } from '../hooks/useForge';
import { useAdvancedForge } from '../hooks/useAdvancedForge';
import {
  fetchRecentAttempts,
  fetchProbabilityHistory,
  fetchMerkleProof,
  fetchUserStats,
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

// enhancementType: 0 = 기본
const ENHANCEMENT_TYPE = 0;

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

  // 일반/상급 강화 분기 기준
  const isAdvancedMode = level >= 5;
  // 화면에 표시할 레벨 (일반: 0~5, 상급: 5~10)
  const displayLevel = isAdvancedMode ? totalLevel : level;

  // ── 아이템 목록 상태 ─────────────────────────────────────────
  const [userItems, setUserItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(1);

  // ── 상급 강화 해금 알림 ──────────────────────────────────────
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

  // ── 최근 강화 결과 (서버) ────────────────────────────────────
  const [recentAttempts, setRecentAttempts] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);

  // ── 확률표 (서버에서 최신 값 로드) ──────────────────────────
  const [probTable, setProbTable] = useState(DEFAULT_PROB_TABLE);

  // 지갑 연결 시 아이템 목록 로드
  useEffect(() => {
    if (!address) return;
    setItemsLoading(true);
    setItemsError(false);
    fetchUserStats(address)
      .then((data) => {
        const items = data.items ?? [];
        setUserItems(items);
        if (items.length > 0 && !items.find((it) => Number(it.itemId) === selectedItemId)) {
          setSelectedItemId(Number(items[0].itemId));
        }
        // 백엔드에 아이템이 없으면(강화 이력 없음) itemId=1로 시작 가능하게 폴백
        if (items.length === 0) {
          setSelectedItemId(1);
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

  // 강화 완료 시 최근 목록 + 아이템 레벨 갱신
  useEffect(() => {
    if (status !== 'done' || !address) return;

    fetchRecentAttempts(8)
      .then((data) => {
        setRecentAttempts(data.attempts ?? []);
        setRecentLoading(false);
      })
      .catch(() => {
        setRecentLoading(false);
      });

    fetchUserStats(address)
      .then((data) => setUserItems(data.items ?? []))
      .catch(() => {});
  }, [status, address]);

  // ── 강화 버튼 핸들러 (level 0이면 proof 먼저 발급) ───────────
  const handleForge = useCallback(async () => {
    setProofError(null);
    let proof = [];

    if (level === 0) {
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
    }

    forge(selectedItemId, ENHANCEMENT_TYPE, proof);
  }, [level, address, selectedItemId, forge]);

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

  useEffect(() => {
    if (advLastResult) spawnParticles(advLastResult.success);
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

  // 인덱서 미운영 시 훅 레벨로 아이템 합성 (백엔드에 아이템 없을 때 폴백)
  const displayItems =
    userItems.length > 0
      ? userItems
      : level > 0
      ? [{ itemId: String(selectedItemId), level }]
      : [];

  // ── 파생 값 ──────────────────────────────────────────────────
  const isForging = isAdvancedMode
    ? advStatus === 'waiting_tx' || advStatus === 'waiting_vrf'
    : status === 'waiting_tx' || status === 'waiting_vrf';
  const currentProb = !isAdvancedMode ? (probTable[level]?.prob ?? 0) : null;

  // 최근 강화 표시용 변환
  const recentRows = recentAttempts.map((a) => ({
    tx: a.requestedTxHash ? shortenTx(a.requestedTxHash) : `#${a.attemptId}`,
    stage: `Lv.${a.beforeLevel}`,
    result: a.success ? 'S' : 'F',
    time: formatDateTime(a.requestedAt),
  }));

  // 강화 결과 상태 (UI 표시용 — 일반/상급 통합)
  const activeResult = isAdvancedMode ? advLastResult : lastResult;
  const resultState = activeResult ? (activeResult.success ? 'success' : 'fail') : null;

  return (
    <div className={styles.page}>
      <Header address={address} onConnect={onConnect} />

      <div className={styles.grid}>
        {/* ── 고양이 강화 섹션 ── */}
        <div className={styles.leftCard}>
          {/* 고양이 아이템 목록 */}
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
                      {CAT_EMOJIS[Math.min(item.level, CAT_EMOJIS.length - 1)]}
                    </span>
                    <span className={`${styles.catListMeta} ${isSelected ? styles.catListMetaSelected : ''}`}>
                      #{iid} · Lv.{item.level}
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
                <span style={{ color: '#9b7de0', fontWeight: 700 }}>상급 선택</span>
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

          {/* VRF 대기 안내 */}
          {isForging && (
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
          {(forgeError || advError) && (
            <div style={{ color: 'var(--fail)', fontSize: 13, marginTop: 4 }}>
              ⚠ {forgeError || advError}
            </div>
          )}
          {proofError && (
            <div style={{ color: 'var(--fail)', fontSize: 13, marginTop: 4 }}>🔒 {proofError}</div>
          )}

          {/* 강화 로그 (lastResult) */}
          {(lastResult || advLastResult) && (
            <div className={styles.logList}>
              <div className={styles.logItem}>
                {lastResult && (
                  <>
                    <span className={styles.logStage}>
                      Lv.{lastResult.beforeLevel}→{lastResult.afterLevel}
                    </span>
                    <span className={lastResult.success ? styles.logSuccess : styles.logFail}>
                      {lastResult.success ? '✓ 성공' : '✕ 실패'}
                    </span>
                  </>
                )}
                {advLastResult && (
                  <>
                    <span className={styles.logStage}>
                      Lv.{advLastResult.beforeTotalLevel}→{advLastResult.afterTotalLevel}
                    </span>
                    <span className={advLastResult.success ? styles.logSuccess : styles.logFail}>
                      {advLastResult.success ? '✓ 성공' : '✕ 실패'}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* 액션 버튼 */}
          <div className={styles.actions}>
            <Button
              variant="primary"
              size="xl"
              onClick={handleForge}
              disabled={
                isForging ||
                isFetchingProof ||
                (isAdvancedMode ? advPending || totalLevel >= 10 : isPending || level >= 5)
              }
              loading={isForging || isFetchingProof}
              style={{ flex: '1 1 auto' }}
            >
              {totalLevel >= 10
                ? '🎉 최고 레벨!'
                : (isAdvancedMode ? advPending : isPending)
                ? '⏳ 결과 대기 중…'
                : isFetchingProof
                ? '🔑 등록 확인 중…'
                : isAdvancedMode
                ? '⚒ 상급 강화 시도하기'
                : '⚒ 강화 시도하기'}
            </Button>
            <Button variant="secondary" size="xl" onClick={() => refreshState(selectedItemId)}>
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
