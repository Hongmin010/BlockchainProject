import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Header, Badge, Button, TxHash } from '../components';
import { fetchAttemptByTx, formatDateTime, bpToPercent } from '../api/api';
import styles from './Verify.module.css';

const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

const ADV_RESULT_LABEL = { 0: '실패 (유지)', 1: '성공', 2: '단계 하락', 3: '파괴', 4: '보장 성공' };

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

// 상급 강화(advanced) 상세 행 — 판정 로직 재현은 백엔드 verification에 맡기고 기록·체크 결과만 표시
function buildAdvancedDetailRows(attempt, verification) {
  const isRisky = attempt.mode === 1;
  const advSuccess = attempt.resultType === 1 || attempt.resultType === 4;

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
      label: '강화 모드',
      value: (
        <span
          className={`${styles.mono} ${styles.bold}`}
          style={{ color: isRisky ? 'var(--ember-300)' : '#9b7de0' }}
        >
          {isRisky ? '⚔ 상남자 강화' : '🛡 쫄보 강화'}
        </span>
      ),
    },
    {
      label: '강화 단계',
      value: (
        <span className={`${styles.mono} ${styles.bold}`}>
          Lv. {attempt.beforeTotalLevel} → Lv. {attempt.afterTotalLevel ?? attempt.beforeTotalLevel}
        </span>
      ),
    },
    {
      label: '공개 성공 확률',
      value: (
        <span className={`${styles.mono} ${styles.ember}`}>
          {bpToPercent(attempt.successRateBp)}%
        </span>
      ),
    },
    ...(isRisky
      ? [
          {
            label: '공개 파괴 확률',
            value: (
              <span className={styles.mono} style={{ color: 'var(--fail)' }}>
                💥 {bpToPercent(attempt.destroyRateBp)}%
              </span>
            ),
          },
        ]
      : []),
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
                {attempt.randomValue} % 10000 = {attempt.rollBp ?? '—'}
              </span>
            ),
          },
          {
            label: '판정 결과',
            value: (
              <Badge variant={advSuccess ? 'success' : 'fail'} dot>
                {ADV_RESULT_LABEL[attempt.resultType] ?? '—'}
                {attempt.guaranteed ? ' · 보장 발동' : ''}
              </Badge>
            ),
          },
          {
            label: '조작 여부',
            value: verification.ok ? (
              <Badge variant="success" dot>
                검증됨 · 조작 없음
              </Badge>
            ) : (
              <span>
                <Badge variant="fail" dot>
                  불일치 감지 · 요주의
                </Badge>
                {verification.mismatches?.length > 0 && (
                  <span className={styles.mono} style={{ marginLeft: 8, color: 'var(--fail)', fontSize: 12 }}>
                    ({verification.mismatches.join(', ')})
                  </span>
                )}
              </span>
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
  const [searchParams] = useSearchParams();
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null); // { type, attempt, verification }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleVerify = async (value = input) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!TX_HASH_RE.test(trimmed)) {
      setResult(null);
      setError('올바른 트랜잭션 해시 형식이 아닙니다 — 0x로 시작하는 64자리 16진수를 입력해주세요.');
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const data = await fetchAttemptByTx(trimmed);
      setResult(data);
    } catch (err) {
      setError(
        err.message === 'attempt_not_found'
          ? '해당 해시의 강화 기록을 찾을 수 없습니다 — 인덱서가 아직 수집하지 않았거나 다른 컨트랙트의 트랜잭션일 수 있어요.'
          : err.message
      );
    } finally {
      setLoading(false);
    }
  };

  // /verify?tx=0x... 진입 시 자동 검증 (Records 검증 링크 대응)
  useEffect(() => {
    const tx = searchParams.get('tx');
    if (tx) {
      setInput(tx);
      handleVerify(tx);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const attempt = result?.attempt;
  const verification = result?.verification;
  const isAdvanced = result?.type === 'advanced';
  const isPending = attempt?.status === 'pending';
  const isVerified = isAdvanced
    ? verification?.ok === true
    : verification?.matchesContract === true;

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
            트랜잭션 해시를 입력하면 해당 강화 결과가 조작되지 않았는지 직접 확인합니다.
          </p>
        </div>

        {/* ── 검색 입력 ── */}
        <div className={styles.searchWrap}>
          <input
            className={styles.input}
            placeholder="트랜잭션 해시를 입력하세요 (0x…)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
          />
          <Button
            variant="primary"
            size="lg"
            onClick={() => handleVerify()}
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
              {(isAdvanced
                ? buildAdvancedDetailRows(attempt, verification)
                : buildDetailRows(attempt, verification)
              ).map(({ label, value }, i, arr) => (
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
