import { useState } from 'react';
import { Header, Badge, Button, TxHash } from '../components';
import { fetchAttempt, formatDateTime, bpToPercent } from '../api/api';
import styles from './Verify.module.css';

function buildDetailRows(attempt, verification) {
  const successRatePct = bpToPercent(attempt.claimedSuccessRateBp);
  const roll =
    attempt.randomValue != null ? (BigInt(attempt.randomValue) % 10000n).toString() : '—';

  return [
    {
      label: '트랜잭션 해시 (요청)',
      value: attempt.requestedTxHash ? (
        <TxHash hash={attempt.requestedTxHash} shorten={false} />
      ) : (
        <span className={styles.mono}>—</span>
      ),
    },
    {
      label: '트랜잭션 해시 (완료)',
      value: attempt.completedTxHash ? (
        <TxHash hash={attempt.completedTxHash} shorten={false} />
      ) : (
        <span className={styles.mono}>—</span>
      ),
    },
    {
      label: '강화 단계',
      value: (
        <span className={`${styles.mono} ${styles.bold}`}>
          Lv. {attempt.beforeLevel} → Lv. {attempt.afterLevel ?? attempt.beforeLevel}
        </span>
      ),
    },
    {
      label: '공개 성공 확률',
      value: <span className={`${styles.mono} ${styles.ember}`}>{successRatePct}%</span>,
    },
    {
      label: 'VRF Request ID',
      value: attempt.vrfRequestId ? (
        <TxHash hash={attempt.vrfRequestId} shorten={false} />
      ) : (
        <span className={styles.mono}>—</span>
      ),
    },
    {
      label: '사용된 난수 값',
      value: <span className={styles.mono}>{attempt.randomValue ?? '—'}</span>,
    },
    ...(verification
      ? [
          {
            label: '난수 → roll 값',
            value: (
              <span className={styles.mono}>
                {attempt.randomValue} % 10000 = {roll}{' '}
                {verification.successDerived ? (
                  <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                    {'< ' + attempt.claimedSuccessRateBp + ' ⇒ 성공'}
                  </span>
                ) : (
                  <span style={{ color: 'var(--fail)', fontWeight: 600 }}>
                    {'≥ ' + attempt.claimedSuccessRateBp + ' ⇒ 실패'}
                  </span>
                )}
              </span>
            ),
          },
          {
            label: '판정 결과',
            value: (
              <Badge variant={attempt.success ? 'success' : 'fail'} dot>
                {attempt.success ? '성공' : '실패'}
              </Badge>
            ),
          },
          {
            label: '조작 여부',
            value: verification.matchesContract ? (
              <Badge variant="success" dot>
                검증됨 · 조작 없음
              </Badge>
            ) : (
              <Badge variant="fail" dot>
                불일치 감지 · 요주의
              </Badge>
            ),
          },
        ]
      : []),
    {
      label: '요청 시각',
      value: <span className={styles.mono}>{formatDateTime(attempt.requestedAt)}</span>,
    },
    {
      label: '완료 시각',
      value: <span className={styles.mono}>{formatDateTime(attempt.completedAt)}</span>,
    },
  ];
}

export default function Verify({ address, onConnect }) {
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null); // { attempt, verification }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleVerify = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const data = await fetchAttempt(trimmed);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const attempt = result?.attempt;
  const verification = result?.verification;
  const isPending = attempt?.status === 'pending';
  const isVerified = verification?.matchesContract === true;

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
            Attempt ID(숫자)를 입력하면 결과가 조작되지 않았는지 직접 확인합니다.
          </p>
        </div>

        {/* ── 검색 입력 ── */}
        <div className={styles.searchWrap}>
          <input
            className={styles.input}
            placeholder="Attempt ID를 입력하세요 (예: 4219)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
          />
          <Button
            variant="primary"
            size="lg"
            onClick={handleVerify}
            loading={loading}
            disabled={loading}
          >
            검증하기
          </Button>
        </div>

        {/* ── 에러 ── */}
        {error && (
          <div style={{ color: 'var(--fail)', fontSize: 14, marginBottom: 16, marginTop: -8 }}>
            ⚠ {error}
          </div>
        )}

        {/* ── 설명 카드 ── */}
        <div className={styles.explainer}>
          <div className={styles.explainerIcon}>?</div>
          <div className={styles.explainerText}>
            <strong style={{ color: 'var(--ink-1)' }}>Chainlink VRF</strong>로 난수를 생성합니다.
            난수를 10000으로 나눈 나머지가 공개 확률(bp)보다 작으면 성공, 크거나 같으면 실패. 서버가
            결과를 바꿀 수 없도록 설계되어 있습니다.
          </div>
        </div>

        {/* ── 결과 카드 ── */}
        {attempt && (
          <div className={styles.resultCard}>
            {/* 상태 배너 */}
            {isPending ? (
              <div className={styles.bannerFail} style={{ background: 'var(--bg-2)' }}>
                <div className={styles.bannerIconFail}>⏳</div>
                <div style={{ flex: 1 }}>
                  <div className={styles.bannerTitle} style={{ color: 'var(--ink-2)' }}>
                    VRF 대기 중
                  </div>
                  <div className={styles.bannerDesc}>
                    아직 Chainlink VRF 결과를 수신하지 않았습니다.
                  </div>
                </div>
              </div>
            ) : (
              <div className={isVerified ? styles.bannerSuccess : styles.bannerFail}>
                <div className={isVerified ? styles.bannerIconSuccess : styles.bannerIconFail}>
                  {isVerified ? '✓' : '✕'}
                </div>
                <div style={{ flex: 1 }}>
                  <div className={isVerified ? styles.bannerTitle : styles.bannerTitleFail}>
                    {isVerified ? '이상 없음' : '검증 실패'}
                  </div>
                  <div className={styles.bannerDesc}>
                    {isVerified
                      ? '공개된 확률과 실제 판정이 일치합니다'
                      : '결과가 일치하지 않습니다'}
                  </div>
                </div>
                {attempt.completedTxHash && (
                  <a
                    href={`https://sepolia.basescan.org/tx/${attempt.completedTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="ghost" size="sm">
                      Basescan ↗
                    </Button>
                  </a>
                )}
              </div>
            )}

            {/* 상세 정보 */}
            <div className={styles.detailGrid}>
              {buildDetailRows(attempt, verification).map(({ label, value }, i, arr) => (
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
