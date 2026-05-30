import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Header, Badge, Button, StageBar, TxHash } from '../components';
import { WalletModal } from '../components';
import styles from './Game.module.css';

// 임시로 하드코딩
const PROB_TABLE = [
  { stage: 'Lv.0 → Lv.1', prob: 90 },
  { stage: 'Lv.1 → Lv.2', prob: 70 },
  { stage: 'Lv.2 → Lv.3', prob: 50 },
  { stage: 'Lv.3 → Lv.4', prob: 30 },
  { stage: 'Lv.4 → Lv.5', prob: 10 },
];

const RECENT = [
  { tx: '0x9f2a…b14e', stage: 'Lv.3', result: 'S', time: '2분 전' },
  { tx: '0x771c…0a2d', stage: 'Lv.4', result: 'F', time: '3분 전' },
  { tx: '0x4400…ee91', stage: 'Lv.2', result: 'S', time: '5분 전' },
  { tx: '0xab12…7765', stage: 'Lv.3', result: 'F', time: '6분 전' },
];

const CAT_EMOJIS = ['🐱', '😺', '😸', '🙀', '😻'];

export default function Game({ address, onConnect }) {
  const navigate = useNavigate();
  const [level, setLevel] = useState(3);
  const [forging, setForging] = useState(false);
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const stageRef = useRef(null);
  const catRef = useRef(null);

  const currentProb = level < 5 ? (PROB_TABLE[level - 1]?.prob ?? 0) : 0;

  // 지갑 미연결 시 WalletModal 표시
  if (!address) {
    return (
      <>
        <Header address={address} onConnect={onConnect} />
        <WalletModal
          title="게임을 하려면 지갑이 필요해요"
          onConnect={onConnect}
          onClose={() => navigate(-1)}
        />
      </>
    );
  }

  const spawnParticles = (success) => {
    const stage = stageRef.current;
    if (!stage) return;
    const colors = success ? ['#5fc37a', '#a8f0bc'] : ['#e8623c', '#f0a090'];
    for (let i = 0; i < (success ? 8 : 4); i++) {
      const p = document.createElement('div');
      p.className = styles.particle;
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.left = 30 + Math.random() * 40 + '%';
      p.style.bottom = '30%';
      p.style.animationDelay = Math.random() * 0.3 + 's';
      stage.appendChild(p);
      setTimeout(() => p.remove(), 1200);
    }
  };

  const handleForge = () => {
    if (forging || level >= 5) return;

    setForging(true);
    setResult(null);

    setTimeout(() => {
      const success = Math.random() * 100 < currentProb;

      setResult(success ? 'success' : 'fail');
      spawnParticles(success);

      if (success) setLevel((prev) => Math.min(prev + 1, 5));

      setLogs((prev) => [
        { id: Date.now(), stage: `Lv.${level}→${level + 1}`, result: success ? 'S' : 'F' },
        ...prev.slice(0, 3),
      ]);

      setTimeout(() => {
        setResult(null);
        setForging(false);
      }, 1200);
    }, 800);
  };

  return (
    <div className="cf-page">
      <Header address={address} onConnect={onConnect} />

      <div className={styles.grid}>
        {/* ── 고양이 강화 섹션 ── */}
        <div className={styles.leftCard}>
          {/* 레벨 표시 */}
          <div className={styles.levelRow}>
            <div>
              <div className="cf-cap" style={{ marginBottom: 6 }}>
                현재 단계
              </div>
              <div className={styles.levelDisplay}>
                <span className={styles.levelCurrent}>Lv. {level}</span>
                <span style={{ color: 'var(--ink-3)' }}>→</span>
                <span className={styles.levelNext}>Lv. {level + 1}</span>
              </div>
            </div>
            <Badge>
              <span style={{ color: 'var(--ink-3)' }}>성공률</span>
              <span style={{ color: 'var(--ember-300)', fontWeight: 700 }}>{currentProb}%</span>
            </Badge>
          </div>

          {/* 단계 바 */}
          <div style={{ marginBottom: 24 }}>
            <StageBar current={level} max={5} />
          </div>

          {/* 고양이 컨테이너 */}
          <div
            ref={stageRef}
            className={`${styles.stage} ${result === 'success' ? styles.stageSuccess : ''} ${result === 'fail' ? styles.stageFail : ''}`}
          >
            {/* 체커 패턴 */}
            <div className={styles.checker} />

            {/* 결과 배지 */}
            {result && (
              <div
                className={`${styles.resultBadge} ${result === 'success' ? styles.resultSuccess : styles.resultFail}`}
              >
                {result === 'success' ? '✓ 성공!' : '✕ 실패'}
              </div>
            )}

            {/* 고양이 이모지 */}
            <div
              ref={catRef}
              className={`${styles.cat} ${result === 'success' ? styles.catBounce : ''} ${result === 'fail' ? styles.catShake : ''} ${forging && !result ? styles.catWait : ''}`}
            >
              {CAT_EMOJIS[Math.min(level - 1, CAT_EMOJIS.length - 1)]}
            </div>

            {/* 레벨 배지 */}
            <div className={styles.lvBadge}>LV. {level}</div>
          </div>

          {/* 강화 로그 */}
          {logs.length > 0 && (
            <div className={styles.logList}>
              {logs.map(({ id, stage: s, result: r }) => (
                <div key={id} className={styles.logItem}>
                  <span className={styles.logStage}>{s}</span>
                  <span className={r === 'S' ? styles.logSuccess : styles.logFail}>
                    {r === 'S' ? '✓ 성공' : '✕ 실패'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 액션 버튼 */}
          <div className={styles.actions}>
            <Button
              variant="primary"
              size="xl"
              onClick={handleForge}
              disabled={level >= 5}
              loading={forging}
              style={{ flex: '1 1 auto' }}
            >
              {level >= 5 ? '🎉 최고 레벨!' : '⚒ 강화 시도하기'}
            </Button>
            <Button variant="secondary" size="xl">
              확률 자세히
            </Button>
          </div>
          <div className={styles.gasNote}>
            <span>⛽</span>
            <span>예상 가스비 ~0.0012 ETH · 결과는 블록체인에 기록</span>
          </div>
        </div>

        {/* ── 확률&기록 섹션 ── */}
        <div className={styles.rightCol}>
          {/* 단계별 확률표 */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>단계별 확률표</h3>
              <span className="cf-cap">on-chain published</span>
            </div>
            <div className={styles.probList}>
              {PROB_TABLE.map(({ stage, prob }, i) => {
                const active = i === level - 1;
                return (
                  <div
                    key={stage}
                    className={`${styles.probRow} ${active ? styles.probRowActive : ''}`}
                  >
                    <span className={`${styles.probStage} ${active ? styles.probStageActive : ''}`}>
                      {stage}
                    </span>
                    <div className={styles.probBarWrap}>
                      <div
                        className={`${styles.probBarFill} ${active ? styles.probBarActive : ''}`}
                        style={{ width: `${prob}%` }}
                      />
                    </div>
                    <span className={`${styles.probValue} ${active ? styles.probValueActive : ''}`}>
                      {prob}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 최근 강화 결과 */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>최근 강화 결과</h3>
              <span className="cf-cap">
                <span style={{ color: 'var(--success)' }}>●</span> live · 글로벌
              </span>
            </div>
            <div className={styles.recentList}>
              {RECENT.map(({ tx, stage, result: r, time }) => (
                <div key={tx} className={styles.recentRow}>
                  <div className={styles.recentInfo}>
                    <TxHash hash={tx} shorten={false} />
                    <span className={styles.recentSub}>
                      {stage} · {time}
                    </span>
                  </div>
                  <Badge variant={r === 'S' ? 'success' : 'fail'} dot>
                    {r === 'S' ? '성공' : '실패'}
                  </Badge>
                </div>
              ))}
              <div className={styles.recentMore}>
                <Link to="/records" className={styles.recentMoreLink}>
                  전체 보기 →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
