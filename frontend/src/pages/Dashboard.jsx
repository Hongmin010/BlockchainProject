import { Header } from '../components';
import styles from './Dashboard.module.css';

// 임시로 하드코딩
const SUMMARY = [
  { label: '전체 강화 시도', value: '48,217', sub: 'cumulative' },
  { label: '전체 성공률', value: '52.3%', sub: 'expected 52.1%', tone: 'success' },
  { label: '최고 강화 단계', value: 'Lv.5', sub: 'by 0xd2…91 · 어제' },
];

const BARS = [
  ['Lv.0→1', 90, 90.1],
  ['Lv.1→2', 70, 69.8],
  ['Lv.2→3', 50, 50.4],
  ['Lv.3→4', 30, 29.7],
  ['Lv.4→5', 10, 10.2],
];

const SUCCESS_RATE = 0.523;
const SUCCESS_COUNT = 25217;
const FAIL_COUNT = 23000;
const CIRCUMFERENCE = 2 * Math.PI * 80;

export default function Stats({ address, onConnect }) {
  return (
    <div className="cf-page">
      <Header address={address} onConnect={onConnect} />

      <div className={styles.inner}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>전체 통계</h1>
          <span className="cf-cap">
            <span style={{ color: 'var(--success)' }}>●</span> 실시간 · on-chain aggregated
          </span>
        </div>

        {/* ── 요약 카드 ── */}
        <div className={styles.summaryGrid}>
          {SUMMARY.map(({ label, value, sub, tone }) => (
            <div key={label} className={styles.summaryCard}>
              <div className="cf-cap">{label}</div>
              <div
                className={styles.summaryValue}
                style={{ color: tone === 'success' ? 'var(--success)' : 'var(--ink-1)' }}
              >
                {value}
              </div>
              <div className={styles.summarySub}>{sub}</div>
            </div>
          ))}
        </div>

        {/* ── 차트 영역 ── */}
        <div className={styles.chartGrid}>
          {/* 막대 차트 */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h3 className={styles.cardTitle}>단계별 성공률</h3>
                <div className="cf-cap" style={{ marginTop: 4 }}>
                  공개 확률 vs 실제 결과
                </div>
              </div>
              <div className={styles.legend}>
                <span className={styles.legendItem}>
                  <span className={styles.legendDotGray} />
                  <span style={{ color: 'var(--ink-2)' }}>공개 확률</span>
                </span>
                <span className={styles.legendItem}>
                  <span className={styles.legendDotEmber} />
                  <span style={{ color: 'var(--ink-2)' }}>실제 결과</span>
                </span>
              </div>
            </div>

            <div className={styles.barChart}>
              {BARS.map(([label, expected, actual]) => (
                <div key={label} className={styles.barGroup}>
                  <div className={styles.bars}>
                    <div className={styles.barExpected} style={{ height: `${expected}%` }} />
                    <div className={styles.barActual} style={{ height: `${actual}%` }} />
                  </div>
                  <div className={styles.barLabel}>{label}</div>
                </div>
              ))}
            </div>

            <div className={styles.verifyNote}>
              <span style={{ color: 'var(--success)' }}>✓</span>
              <span>
                모든 단계에서 실제 결과가 공개 확률 ±1% 이내 —{' '}
                <strong style={{ color: 'var(--success)' }}>이상 없음</strong>
              </span>
            </div>
          </div>

          {/* 도넛 차트 */}
          <div className={styles.card}>
            <div style={{ marginBottom: 18 }}>
              <h3 className={styles.cardTitle}>성공 vs 실패</h3>
              <div className="cf-cap" style={{ marginTop: 4 }}>
                전체 누적
              </div>
            </div>

            <div className={styles.donutWrap}>
              <svg width="220" height="220" viewBox="0 0 220 220">
                <defs>
                  <linearGradient id="emberGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#ffa85f" />
                    <stop offset="100%" stopColor="#ff7a1a" />
                  </linearGradient>
                </defs>
                <circle
                  cx="110"
                  cy="110"
                  r="80"
                  fill="none"
                  stroke="var(--bg-3)"
                  strokeWidth="32"
                />
                <circle
                  cx="110"
                  cy="110"
                  r="80"
                  fill="none"
                  stroke="url(#emberGrad)"
                  strokeWidth="32"
                  strokeLinecap="round"
                  strokeDasharray={`${SUCCESS_RATE * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
                  transform="rotate(-90 110 110)"
                  style={{ filter: 'drop-shadow(0 0 8px rgba(255,122,26,0.4))' }}
                />
                <text
                  x="110"
                  y="106"
                  textAnchor="middle"
                  fontFamily="var(--font)"
                  fontWeight="800"
                  fontSize="32"
                  fill="var(--ink-1)"
                  letterSpacing="-0.03em"
                >
                  52.3%
                </text>
                <text
                  x="110"
                  y="128"
                  textAnchor="middle"
                  fontFamily="var(--mono)"
                  fontSize="10"
                  fill="var(--ink-3)"
                  letterSpacing="0.1em"
                >
                  SUCCESS
                </text>
              </svg>
            </div>

            <div className={styles.donutLegend}>
              <div className={styles.donutLegendItem}>
                <div className="cf-cap" style={{ color: 'var(--success)' }}>
                  ● 성공
                </div>
                <div className={styles.donutLegendValue}>{SUCCESS_COUNT.toLocaleString()}</div>
              </div>
              <div className={styles.donutDivider} />
              <div className={styles.donutLegendItem}>
                <div className="cf-cap" style={{ color: 'var(--fail)' }}>
                  ● 실패
                </div>
                <div className={styles.donutLegendValue}>{FAIL_COUNT.toLocaleString()}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
