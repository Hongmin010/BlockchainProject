import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Header, Card, Badge, Button, CharacterStage } from '../components';
import { fetchGlobalStats, fetchRanking, bpToPercent } from '../api/api';
import catHero from '../assets/cats/0.png';
import styles from './Landing.module.css';

export default function Landing({ address, onConnect }) {
  const [globalStats, setGlobalStats] = useState(null);
  const [maxLevel, setMaxLevel] = useState(null);

  useEffect(() => {
    let cancelled = false;

    // 일부 API가 실패해도 나머지는 표시되도록 allSettled 사용
    Promise.allSettled([fetchGlobalStats(), fetchRanking(1)]).then(([global, ranking]) => {
      if (cancelled) return;
      if (global.status === 'fulfilled') setGlobalStats(global.value);
      if (ranking.status === 'fulfilled') {
        setMaxLevel(ranking.value.topItems?.[0]?.totalLevel ?? null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const stats = [
    {
      value: globalStats ? globalStats.completedAttempts.toLocaleString() : '—',
      label: '전체 강화 시도',
    },
    {
      value: globalStats ? `${bpToPercent(globalStats.observedRateBp)}%` : '—',
      label: '실제 성공률',
      color: 'var(--success)',
    },
    { value: maxLevel != null ? `Lv.${maxLevel}` : '—', label: '최고 단계' },
  ];

  return (
    <div className="cf-page">
      <Header address={address} onConnect={onConnect} />

      {/* ── 히어로 섹션 ── */}
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <Badge style={{ marginBottom: 24 }}>
            <span style={{ color: 'var(--ember-300)' }}>●</span>
            온체인 검증 가능 · Chainlink VRF
          </Badge>

          <h1 className={styles.heroTitle}>
            확률을,
            <br />
            <span className="cf-grad-text">의심 없이.</span>
          </h1>

          <p className={styles.heroDesc}>
            CatForge는 모든 강화 결과가 블록체인에 기록되는
            <br />
            고양이 강화 게임입니다. 누구나 검증할 수 있어요.
          </p>

          <div className={styles.heroCta}>
            <Link to="/game">
              <Button variant="primary" size="xl">
                게임 시작하기 →
              </Button>
            </Link>
            <Link to="/dashboard">
              <Button variant="ghost" size="xl">
                먼저 통계 보기
              </Button>
            </Link>
          </div>

          {/* 신뢰 지표 */}
          <div className={styles.trustStrip}>
            {stats.map(({ value, label, color }) => (
              <div key={label}>
                <div className={styles.trustValue} style={{ color }}>
                  {value}
                </div>
                <div className="cf-cap" style={{ marginTop: 4 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 고양이 섹션 */}
        <div className={styles.heroVisual}>
          <CharacterStage size={420} showBadge={false}>
            <img src={catHero} alt="CatForge 고양이" className={styles.heroCat} />
          </CharacterStage>
        </div>
      </section>

      {/* ── 하단 CTA ── */}
      <section className={styles.ctaSection}>
        <Card className={styles.ctaCard}>
          <div>
            <div className={styles.ctaTitle}>아직 못 믿겠다면?</div>
            <div className={styles.ctaDesc}>
              지금까지 모든 강화 데이터를 통계 대시보드로 확인해보세요.
            </div>
          </div>
          <Link to="/dashboard">
            <Button variant="secondary" size="lg">
              통계 보러 가기 →
            </Button>
          </Link>
        </Card>
      </section>
    </div>
  );
}
