import { AdvancedMode } from '../../hooks/useAdvancedForge';
import styles from '../Game.module.css';

// 확률표 카드 (일반/상급 + 쫄보/상남자 탭, 보장 인디케이터 포함)
export default function ProbabilityCard({
  isAdvancedMode,
  advMode,
  onModeChange,
  probTable,
  advProbTable,
  level,
  extraLevel,
  isGuaranteed,
  isRiskyBlocked,
  safeDropStreak,
}) {
  return (
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
              onClick={() => onModeChange(AdvancedMode.Safe)}
            >
              쫄보 강화
              {isGuaranteed && <span className={styles.guaranteedDot}>🌟</span>}
            </button>
            <button
              className={`${styles.advModeTab} ${advMode === AdvancedMode.Risky ? styles.advModeTabActiveRisky : ''} ${isRiskyBlocked ? styles.advModeTabBlocked : ''}`}
              onClick={() => !isRiskyBlocked && onModeChange(AdvancedMode.Risky)}
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
  );
}
