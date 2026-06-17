import { useCallback, useEffect, useRef } from 'react';
import { AdvancedResultType } from '../../hooks/useAdvancedForge';
import styles from '../Game.module.css';
import { CAT_EMOJIS, ADV_RESULT_INFO } from './constants';

// 고양이 무대 (결과 배지 + 레벨 배지 + 파티클 이펙트)
export default function ForgeStage({ isAdvancedMode, displayLevel, isForging, lastResult, advLastResult }) {
  const stageRef = useRef(null);

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
  );
}
