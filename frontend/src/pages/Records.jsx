import { Link, useNavigate } from 'react-router-dom';
import { Header, Badge, TxHash, Button, WalletModal } from '../components';
import styles from './Records.module.css';

// 임시로 하드코딩
const SUMMARY = [
  { label: '총 시도', value: '128', sub: 'lifetime', icon: '⚒', tone: null },
  { label: '성공', value: '71', sub: '55.4%', icon: '✓', tone: 'success' },
  { label: '실패', value: '57', sub: '44.6%', icon: '✕', tone: 'fail' },
];

const RECORDS = [
  { tx: '0x9f2a…b14e', stage: 'Lv.4 → Lv.5', result: 'S', time: '2026-05-06 14:21' },
  { tx: '0x771c…0a2d', stage: 'Lv.5 → Lv.6', result: 'F', time: '2026-05-06 14:08' },
  { tx: '0x4400…ee91', stage: 'Lv.5 → Lv.6', result: 'F', time: '2026-05-05 22:14' },
  { tx: '0xab12…7765', stage: 'Lv.4 → Lv.5', result: 'S', time: '2026-05-05 21:55' },
  { tx: '0x0e88…d04c', stage: 'Lv.3 → Lv.4', result: 'S', time: '2026-05-05 19:30' },
  { tx: '0x66a1…3320', stage: 'Lv.4 → Lv.5', result: 'F', time: '2026-05-04 09:11' },
  { tx: '0xc012…aa90', stage: 'Lv.3 → Lv.4', result: 'S', time: '2026-05-03 18:42' },
];

export default function Records({ address, onConnect }) {
  const navigate = useNavigate();
  // 지갑 미연결 시 WalletModal 표시
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

  return (
    <div className="cf-page">
      <Header address={address} onConnect={onConnect} />

      <div className={styles.inner}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>내 강화 기록</h1>
            <span className="cf-cap">
              {short ? (
                <>
                  <span style={{ color: 'var(--success)' }}>●</span> connected · {short}
                </>
              ) : (
                <>
                  <span style={{ color: 'var(--ink-4)' }}>●</span> 지갑 미연결
                </>
              )}
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

        {/* ── 요약 카드 ── */}
        <div className={styles.summaryGrid}>
          {SUMMARY.map(({ label, value, sub, icon, tone }) => (
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
              {RECORDS.map(({ tx, stage, result, time }) => (
                <tr key={tx}>
                  <td>
                    <TxHash hash={tx} shorten={false} />
                  </td>
                  <td className={styles.monoCell}>{stage}</td>
                  <td>
                    <Badge variant={result === 'S' ? 'success' : 'fail'} dot>
                      {result === 'S' ? '성공' : '실패'}
                    </Badge>
                  </td>
                  <td className={styles.timeCell}>{time}</td>
                  <td className={styles.actionCell}>
                    <Link to="/verify" className={styles.verifyLink}>
                      검증 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 페이지네이션 - 임시로 하드코딩 */}
          <div className={styles.pagination}>
            <span className="cf-cap">128 records · showing 1–7</span>
            <div className={styles.pages}>
              <button className={styles.pageBtn}>‹</button>
              <button className={`${styles.pageBtn} ${styles.active}`}>1</button>
              <button className={styles.pageBtn}>2</button>
              <button className={styles.pageBtn}>3</button>
              <span className={styles.pageDot}>…</span>
              <button className={styles.pageBtn}>19</button>
              <button className={styles.pageBtn}>›</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
