import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Header, Badge, TxHash, Button, WalletModal } from '../components';
import { fetchUserStats, fetchRecentAttempts, bpToPercent, formatDateTime } from '../api/api';
import styles from './Records.module.css';

const PAGE_SIZE = 7;

export default function Records({ address, onConnect }) {
  const navigate = useNavigate();

  const [userStats, setUserStats] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!address) return;

    Promise.all([fetchUserStats(address), fetchRecentAttempts(100, address)])
      .then(([stats, recent]) => {
        setPage(1);
        setUserStats(stats);
        setAttempts(recent.attempts ?? []);
        setLoading(false);
        setError(null);
      })
      .catch((err) => {
        setLoading(false);
        setError(err.message);
      });
  }, [address]);

  // 지갑 미연결
  if (!address) {
    return (
      <>
        <Header address={address} onConnect={onConnect} />
        <WalletModal
          title="내 기록을 보려면 지갑이 필요해요"
          onConnect={onConnect}
          onClose={() => navigate(-1)}
        />
      </>
    );
  }

  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;

  // ── 요약 카드 데이터 ─────────────────────────────────────────
  const totalAttempts = userStats?.completedAttempts ?? 0;
  const successes = userStats?.successes ?? 0;
  const fails = totalAttempts - successes;
  const successPct = totalAttempts > 0 ? bpToPercent(userStats.observedRateBp) : '0.00';
  const failPct = totalAttempts > 0 ? (100 - parseFloat(successPct)).toFixed(2) : '0.00';

  const summaryCards = [
    {
      label: '총 시도',
      value: totalAttempts.toLocaleString(),
      sub: 'lifetime',
      icon: '⚒',
      tone: null,
    },
    {
      label: '성공',
      value: successes.toLocaleString(),
      sub: `${successPct}%`,
      icon: '✓',
      tone: 'success',
    },
    { label: '실패', value: fails.toLocaleString(), sub: `${failPct}%`, icon: '✕', tone: 'fail' },
  ];

  // ── 페이지네이션 ─────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(attempts.length / PAGE_SIZE));
  const paged = attempts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className={styles.page}>
      <Header address={address} onConnect={onConnect} />

      <div className={styles.inner}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>내 강화 기록</h1>
            <span className="cf-cap">
              <span style={{ color: 'var(--success)' }}>●</span> connected · {short}
            </span>
          </div>
          <div className={styles.titleActions}>
            <Button variant="ghost" size="sm">
              CSV 내보내기
            </Button>
            <Button variant="ghost" size="sm">
              필터 ▾
            </Button>
          </div>
        </div>

        {/* 에러 */}
        {error && (
          <div style={{ color: 'var(--fail)', fontSize: 14, marginBottom: 16 }}>⚠ {error}</div>
        )}

        {/* 요약 카드 — 에러 없을 때만 표시 */}
        {!error && (
          <div className={styles.summaryGrid}>
            {summaryCards.map(({ label, value, sub, icon, tone }) => (
              <div key={label} className={styles.summaryCard}>
                <div
                  className={styles.summaryIcon}
                  style={{
                    color:
                      tone === 'success'
                        ? 'var(--success)'
                        : tone === 'fail'
                          ? 'var(--fail)'
                          : 'var(--ember-300)',
                  }}
                >
                  {icon}
                </div>
                <div className="cf-cap">{label}</div>
                <div
                  className={styles.summaryValue}
                  style={{
                    color:
                      tone === 'success'
                        ? 'var(--success)'
                        : tone === 'fail'
                          ? 'var(--fail)'
                          : 'var(--ink-1)',
                  }}
                >
                  {value}
                </div>
                <div className={styles.summarySub}>{sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── 테이블 ── */}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>트랜잭션</th>
                <th>강화 단계</th>
                <th>결과</th>
                <th>시각</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={5}
                    style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ink-3)' }}
                  >
                    불러오는 중…
                  </td>
                </tr>
              )}
              {!loading && paged.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ink-3)' }}
                  >
                    강화 기록이 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                paged.map((a) => (
                  <tr key={a.attemptId}>
                    <td>
                      <TxHash hash={a.requestedTxHash} shorten={false} />
                    </td>
                    <td className={styles.monoCell}>
                      Lv.{a.beforeLevel} → Lv.{a.afterLevel ?? a.beforeLevel}
                    </td>
                    <td>
                      <Badge variant={a.success ? 'success' : 'fail'} dot>
                        {a.success ? '성공' : '실패'}
                      </Badge>
                    </td>
                    <td className={styles.timeCell}>{formatDateTime(a.requestedAt)}</td>
                    <td className={styles.actionCell}>
                      <Link to={`/verify?id=${a.attemptId}`} className={styles.verifyLink}>
                        검증 →
                      </Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          {/* 페이지네이션 */}
          <div className={styles.pagination}>
            <span className="cf-cap">
              {attempts.length} records · showing{' '}
              {Math.min((page - 1) * PAGE_SIZE + 1, attempts.length)}–
              {Math.min(page * PAGE_SIZE, attempts.length)}
            </span>
            <div className={styles.pages}>
              <button
                className={styles.pageBtn}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  className={`${styles.pageBtn} ${p === page ? styles.active : ''}`}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              ))}
              <button
                className={styles.pageBtn}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                ›
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
