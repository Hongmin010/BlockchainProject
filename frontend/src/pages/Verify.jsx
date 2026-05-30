import { useState } from 'react';
import { Header, Badge, Button, TxHash } from '../components';
import styles from './Verify.module.css';

// 임시로 하드코딩
const MOCK_RESULT = {
  tx: '0x9f2a4c8b1e2d6f04a7c3b8d9e1f0a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9',
  block: '#19,284,177',
  stage: 'Lv. 4 → Lv. 5',
  successRate: '10.00%',
  vrf: '0x4d3a8f…91c2',
  calc: '0.0821 < 0.10 ⇒ 성공',
  result: true,
};

const DETAIL_ROWS = (r) => [
  { label: '트랜잭션 해시', value: <TxHash hash={r.tx} shorten={false} /> },
  { label: '블록 번호', value: <span className={styles.mono}>{r.block}</span> },
  { label: '강화 단계', value: <span className={`${styles.mono} ${styles.bold}`}>{r.stage}</span> },
  {
    label: '공개 성공 확률',
    value: <span className={`${styles.mono} ${styles.ember}`}>{r.successRate}</span>,
  },
  { label: '사용된 난수 (VRF)', value: <TxHash hash={r.vrf} shorten={false} /> },
  {
    label: '난수 → 결과값',
    value: (
      <span className={styles.mono}>
        {r.calc.replace('성공', '')}
        <span style={{ color: 'var(--success)', fontWeight: 600 }}>성공</span>
      </span>
    ),
  },
  {
    label: '판정 결과',
    value: (
      <Badge variant="success" dot>
        성공
      </Badge>
    ),
  },
  {
    label: '조작 여부',
    value: (
      <Badge variant="success" dot>
        검증됨 · 조작 없음
      </Badge>
    ),
  },
];

export default function Verify({ address, onConnect }) {
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null);

  const handleVerify = () => {
    if (!input.trim()) return;
    setResult(MOCK_RESULT);
  };

  return (
    <div className={styles.page}>
      <Header address={address} onConnect={onConnect} />

      <div className={styles.inner}>
        <div className={styles.titleSection}>
          <Badge style={{ marginBottom: 18, display: 'inline-flex' }}>
            <span style={{ color: 'var(--ember-300)' }}>✦</span>
            <span style={{ color: 'var(--ink-2)' }}>누구나 · 지갑 없이 · 무료</span>
          </Badge>
          <h1 className={styles.title}>온체인 검증</h1>
          <p className={styles.desc}>
            트랜잭션 해시를 입력하면 결과가 조작되지 않았는지 직접 확인합니다.
          </p>
        </div>

        {/* ── 검색 입력 ── */}
        <div className={styles.searchWrap}>
          <input
            className={styles.input}
            placeholder="트랜잭션 해시를 입력하세요 (0x...)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
          />
          <Button variant="primary" size="lg" onClick={handleVerify}>
            검증하기
          </Button>
        </div>

        {/* ── 설명 카드 ── */}
        <div className={styles.explainer}>
          <div className={styles.explainerIcon}>?</div>
          <div className={styles.explainerText}>
            <strong style={{ color: 'var(--ink-1)' }}>Chainlink VRF</strong>로 난수를 생성합니다.
            난수값이 공개 확률보다 작으면 성공, 크면 실패. 서버가 결과를 바꿀 수 없도록 설계되어
            있습니다.
          </div>
        </div>

        {/* ── 결과 카드 ── */}
        {result && (
          <div className={styles.resultCard}>
            {/* 상태 배너 */}
            <div className={result.result ? styles.bannerSuccess : styles.bannerFail}>
              <div className={result.result ? styles.bannerIconSuccess : styles.bannerIconFail}>
                {result.result ? '✓' : '✕'}
              </div>
              <div style={{ flex: 1 }}>
                <div className={result.result ? styles.bannerTitle : styles.bannerTitleFail}>
                  {result.result ? '이상 없음' : '검증 실패'}
                </div>
                <div className={styles.bannerDesc}>
                  {result.result
                    ? '공개된 확률과 실제 판정이 일치합니다'
                    : '결과가 일치하지 않습니다'}
                </div>
              </div>
              <a
                href={`https://sepolia.basescan.org/tx/${result.tx}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="ghost" size="sm">
                  Basescan ↗
                </Button>
              </a>
            </div>

            {/* 상세 정보 */}
            <div className={styles.detailGrid}>
              {DETAIL_ROWS(result).map(({ label, value }, i, arr) => (
                <div
                  key={label}
                  className={styles.detailRow}
                  style={{ borderBottom: i === arr.length - 1 ? 'none' : '1px solid var(--bg-3)' }}
                >
                  <div className="cf-cap">{label}</div>
                  <div>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
