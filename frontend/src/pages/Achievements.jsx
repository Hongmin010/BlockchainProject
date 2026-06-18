import { useEffect, useState } from 'react';
import { Header } from '../components';
import { fetchAchievements } from '../api/api';
import {
  USE_MOCK_ACHIEVEMENTS,
  MOCK_ACHIEVEMENTS,
  ACHIEVEMENT_DISPLAY,
  STATUS_LABEL,
} from './Achievements/constants';
import styles from './Achievements.module.css';

/**
 * 업적 박물관 페이지 — 백엔드 업적 목록(ID 3~10)을 획득/미획득으로 나눠 모아 보여준다.
 * 목록/이름/조건은 API 응답을 그대로 렌더하고, 아이콘·등급만 constants로 매핑한다.
 * (constants.USE_MOCK_ACHIEVEMENTS = true 면 MOCK 데이터로 렌더)
 */
export default function Achievements({ address, onConnect }) {
  const [achievements, setAchievements] = useState(
    USE_MOCK_ACHIEVEMENTS ? MOCK_ACHIEVEMENTS : null
  );
  const [loading, setLoading] = useState(!USE_MOCK_ACHIEVEMENTS);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (USE_MOCK_ACHIEVEMENTS) return;
    if (!address) {
      setAchievements(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchAchievements(address)
      .then((data) => {
        if (cancelled) return;
        setAchievements(data.achievements ?? []);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const unlocked = (achievements ?? []).filter((a) => a.unlocked);
  const locked = (achievements ?? []).filter((a) => !a.unlocked);
  const total = achievements?.length ?? 0;

  return (
    <div className={styles.page}>
      <Header address={address} onConnect={onConnect} />

      <div className={styles.inner}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>🏛️ 업적 박물관</h1>
          <span className="cf-cap">CatForge Soulbound NFT</span>
        </div>

        {USE_MOCK_ACHIEVEMENTS && (
          <div className={styles.mockNotice}>
            🧪 미리보기 데이터입니다 — 백엔드 업적 API 배포 후 실제 보유 현황으로 연결됩니다.
          </div>
        )}
        {!USE_MOCK_ACHIEVEMENTS && !address && (
          <div className={styles.notice}>지갑을 연결하면 보유한 업적을 확인할 수 있어요.</div>
        )}
        {error && <div className={styles.errorNotice}>⚠ {error}</div>}
        {loading && <div className={styles.notice}>불러오는 중…</div>}

        {achievements && !loading && (
          <>
            <div className={styles.summary}>
              <span className={styles.summaryNum}>{unlocked.length}</span>
              <span className={styles.summaryTotal}>/ {total} 획득</span>
            </div>

            <h2 className={styles.sectionTitle}>획득한 업적</h2>
            {unlocked.length === 0 ? (
              <div className={styles.empty}>아직 획득한 업적이 없어요. 강화에 도전해 보세요!</div>
            ) : (
              <div className={styles.grid}>
                {unlocked.map((a) => (
                  <AchievementCard key={a.achievementId} ach={a} />
                ))}
              </div>
            )}

            <h2 className={styles.sectionTitle}>미획득 업적</h2>
            {locked.length === 0 ? (
              <div className={styles.empty}>모든 업적을 달성했어요! 🎉</div>
            ) : (
              <div className={styles.grid}>
                {locked.map((a) => (
                  <AchievementCard key={a.achievementId} ach={a} locked />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AchievementCard({ ach, locked = false }) {
  const display = ACHIEVEMENT_DISPLAY[ach.achievementId] ?? { icon: '🏆' };

  return (
    <div className={`${styles.card} ${locked ? styles.cardLocked : ''}`}>
      <div className={styles.icon}>{display.icon}</div>
      <div className={styles.name}>{ach.name}</div>
      <div className={styles.condition}>{ach.condition}</div>
      <div className={styles.cardFoot}>
        {locked ? (
          <span className={styles.lockedBadge}>🔒 미획득</span>
        ) : (
          <span className={styles.unlockedBadge}>{STATUS_LABEL[ach.status] ?? '획득'}</span>
        )}
        <span className={styles.source}>{ach.source === 'onchain' ? '온체인' : '오프체인'}</span>
      </div>
    </div>
  );
}
