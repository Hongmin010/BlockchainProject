import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchProbabilityHistory,
  fetchAdvancedRatesHistory,
  bpToPercent,
  formatDateTime,
} from '../api/api';
import { Button } from './index';
import styles from './RateChangeNotice.module.css';

// ── 폴링 설정 (시연 촬영 시 여기만 조정) ────────────────────────
const POLLING_ENABLED = false; // false 면 첫 마운트 시 1회만 확인 / 시연 시 true + 아래 간격 10_000 으로
const POLL_INTERVAL_MS = 60_000; // 시연 때 10_000~15_000 으로 낮춰 사용

// 타입별 "마지막으로 확인한 변경 이벤트 위치" 저장 키
const STORAGE_KEYS = {
  base: 'catforge_rateSeen_base',
  advanced: 'catforge_rateSeen_advanced',
};

function loadSeen(type) {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[type]);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return Number.isFinite(v?.blockNumber) ? v : null;
  } catch {
    return null;
  }
}

function saveSeen(type, marker) {
  if (!marker) return;
  localStorage.setItem(
    STORAGE_KEYS[type],
    JSON.stringify({ blockNumber: marker.blockNumber, logIndex: marker.logIndex ?? 0 })
  );
}

// (blockNumber, logIndex) 기준 a가 b보다 나중인지
function isNewer(a, b) {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber;
  return (a.logIndex ?? 0) > (b.logIndex ?? 0);
}

// 이력 배열 → 최신순 정렬 (base 쪽은 정렬 순서가 보장되지 않으므로 직접 정렬)
function sortDesc(history) {
  return [...(history ?? [])].sort((a, b) => (isNewer(a, b) ? -1 : 1));
}

/**
 * 운영자 확률 변경 글로벌 팝업.
 * 일반(probability/history) + 상급(advanced/rates/history) 변경 이력의 최신 이벤트를
 * localStorage 저장 위치와 비교해, 새 변경이 있으면 상세 내역 팝업을 띄운다.
 * 첫 방문(저장값 없음)은 팝업 없이 현재 위치만 저장.
 */
export default function RateChangeNotice() {
  const [changes, setChanges] = useState(null); // 표시할 변경 항목 리스트 (null = 팝업 닫힘)
  const pendingSeenRef = useRef({}); // 확인 버튼 시 저장할 타입별 최신 마커
  const openRef = useRef(false);

  const check = useCallback(async () => {
    if (openRef.current) return; // 팝업 표시 중에는 갱신하지 않음

    const [baseRes, advRes] = await Promise.allSettled([
      fetchProbabilityHistory(),
      fetchAdvancedRatesHistory(),
    ]);

    const collected = [];
    const pending = {};

    const collect = (type, history) => {
      const sorted = sortDesc(history);
      if (sorted.length === 0) return;

      const newest = sorted[0];
      const seen = loadSeen(type);
      if (!seen) {
        // 첫 방문 — 팝업 없이 현재 위치만 저장
        saveSeen(type, newest);
        return;
      }
      const fresh = sorted.filter((h) => isNewer(h, seen));
      if (fresh.length === 0) return;

      pending[type] = newest;
      for (const h of fresh) collected.push({ type, ...h });
    };

    if (baseRes.status === 'fulfilled') collect('base', baseRes.value?.history);
    if (advRes.status === 'fulfilled') collect('advanced', advRes.value?.history);

    if (collected.length > 0) {
      collected.sort((a, b) => (isNewer(a, b) ? -1 : 1));
      pendingSeenRef.current = pending;
      openRef.current = true;
      setChanges(collected);
    }
  }, []);

  useEffect(() => {
    check();
    if (!POLLING_ENABLED) return;
    const timer = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [check]);

  const handleConfirm = () => {
    for (const [type, marker] of Object.entries(pendingSeenRef.current)) {
      saveSeen(type, marker);
    }
    pendingSeenRef.current = {};
    openRef.current = false;
    setChanges(null);
  };

  if (!changes) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.icon}>📢</div>

        <h2 className={styles.title}>확률이 조정되었습니다</h2>
        <p className={styles.desc}>
          운영자가 강화 확률을 변경했어요. 아래 내역을 확인해 주세요.
          <br />
          변경 사항은 온체인에 기록되어 있습니다.
        </p>

        <div className={styles.changeList}>
          {changes.map((c, i) => (
            <ChangeItem key={`${c.type}-${c.txHash}-${c.logIndex}-${i}`} change={c} />
          ))}
        </div>

        <Button variant="primary" size="lg" onClick={handleConfirm} className={styles.confirmBtn}>
          확인했어요
        </Button>
      </div>
    </div>
  );
}

function ChangeItem({ change: c }) {
  const isAdv = c.type === 'advanced';
  const target = isAdv
    ? `상급 강화 ${c.mode === 1 ? '🔥 상남자' : '🛡 쫄보'} +${c.extraLevel}`
    : `일반 강화 Lv ${c.level}`;

  return (
    <div className={styles.changeItem}>
      <div className={styles.changeTarget}>
        {target}
        <span className={styles.changeTime}>{formatDateTime(c.onChainTimestamp)}</span>
      </div>
      <RateRow label="성공" oldBp={c.oldSuccessRateBp} newBp={c.newSuccessRateBp} />
      {isAdv && c.mode === 1 && (
        <RateRow label="파괴" oldBp={c.oldDestroyRateBp} newBp={c.newDestroyRateBp} invert />
      )}
    </div>
  );
}

// invert: 파괴 확률은 올라가는 게 불리하므로 색상 반전
function RateRow({ label, oldBp, newBp, invert = false }) {
  if (newBp == null || oldBp === newBp) return null;
  const up = oldBp == null || newBp > oldBp;
  const goodForUser = invert ? !up : up;
  return (
    <div className={styles.changeRow}>
      <span className={styles.rateLabel}>{label}</span>
      <span className={styles.oldRate}>{oldBp == null ? '—' : `${bpToPercent(oldBp)}%`}</span>
      <span>→</span>
      <span className={`${styles.newRate} ${goodForUser ? styles.rateUp : styles.rateDown}`}>
        {bpToPercent(newBp)}%
      </span>
    </div>
  );
}
