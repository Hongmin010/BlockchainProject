import { useCallback, useEffect, useRef, useState } from 'react';
import { AdvancedResultType } from '../../hooks/useAdvancedForge';
import styles from '../Game.module.css';
import { ADV_RESULT_INFO, catImageForLevel, DESTROY_IMAGE } from './constants';

// 파괴용 이미지를 보여주는 시간(ms). 이 동안은 5레벨 이미지 대신 파괴 연출을 띄운다.
const DESTROY_ANIM_MS = 1000;

// 결과 배지/연출이 화면에 떠 있는 시간(ms). 이 시간이 지나면 자동으로 사라진다.
const RESULT_VISIBLE_MS = 2500;

// 고양이 무대 (결과 배지 + 레벨 배지 + 파티클 이펙트)
export default function ForgeStage({ isAdvancedMode, displayLevel, isForging, lastResult, advLastResult }) {
  const stageRef = useRef(null);

  // 상남자 강화 파괴 시: displayLevel은 이미 5로 떨어져 있으므로,
  // 잠깐 파괴용 이미지를 띄웠다가 5레벨 이미지로 전환하기 위한 연출 상태.
  const [isDestroying, setIsDestroying] = useState(false);

  // 결과 배지/연출을 잠깐만 보여주기 위한 표시 상태. 새 결과가 오면 다시 켜지고,
  // RESULT_VISIBLE_MS 후 자동으로 꺼진다.
  const [resultVisible, setResultVisible] = useState(false);

  useEffect(() => {
    if (advLastResult?.resultType !== AdvancedResultType.Destroyed) return;
    setIsDestroying(true);
    const t = setTimeout(() => setIsDestroying(false), DESTROY_ANIM_MS);
    return () => clearTimeout(t);
  }, [advLastResult]);

  useEffect(() => {
    const result = isAdvancedMode ? advLastResult : lastResult;
    if (!result) return;
    setResultVisible(true);
    const t = setTimeout(() => setResultVisible(false), RESULT_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [isAdvancedMode, lastResult, advLastResult]);

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

  // 스테이지 이펙트 상태 (resultVisible 동안만 표시)
  let stageState = null;
  if (!resultVisible) {
    stageState = null;
  } else if (isAdvancedMode && advLastResult) {
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
        {isDestroying ? (
          <img src={DESTROY_IMAGE} alt="파괴" className={styles.catImage} />
        ) : (
          <img
            src={catImageForLevel(displayLevel)}
            alt={`Lv.${displayLevel} 고양이`}
            className={styles.catImage}
          />
        )}
      </div>

      <div className={`${styles.lvBadge} ${isAdvancedMode ? styles.lvBadgeAdvanced : ''}`}>
        LV. {displayLevel}
      </div>
    </div>
  );
}
