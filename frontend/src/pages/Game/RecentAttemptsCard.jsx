import { Link } from 'react-router-dom';
import { Badge, TxHash } from '../../components';
import { formatDateTime, shortenTx } from '../../api/api';
import styles from '../Game.module.css';

const ADV_BADGE = { 0: '실패', 1: '성공', 2: '하락', 3: '파괴', 4: '보장' };

// 최근 강화 결과 카드 (일반 + 상급 기록 병합, 글로벌)
export default function RecentAttemptsCard({ attempts, advAttempts, loading }) {
  const rows = [
    ...attempts.map((a) => ({
      tx: a.requestedTxHash ? shortenTx(a.requestedTxHash) : `#${a.attemptId}`,
      stage: `Lv.${a.beforeLevel}`,
      success: a.success,
      isAdvanced: false,
      sortKey: a.requestedAt,
      time: formatDateTime(a.requestedAt),
    })),
    ...advAttempts.map((a) => ({
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

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>최근 강화 결과</h3>
        <span className="cf-cap">
          <span style={{ color: 'var(--success)' }}>●</span> live · 글로벌
        </span>
      </div>
      <div className={styles.recentList}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--ink-3)', fontSize: 13 }}>
            불러오는 중…
          </div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--ink-3)', fontSize: 13 }}>
            기록 없음
          </div>
        ) : (
          rows.map(({ tx, stage, success, isAdvanced, modeLabel, resultType, time }, idx) => (
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
  );
}
