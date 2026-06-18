import { useEffect, useState } from 'react';
import { Header } from '../components';
import { fetchRanking } from '../api/api';
import styles from './Ranking.module.css';

const RANK_MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

function shortenAddress(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * 랭킹 카드 1개 (테이블 형태)
 *
 * @param {string} title        — 카드 제목
 * @param {string} icon         — 제목 옆 이모지
 * @param {string} valueLabel   — 값 컬럼 헤더
 * @param {Array}  rows         — [{ rank, userAddress, ... }]
 * @param {Function} renderValue — row → 값 셀 내용
 * @param {string|null} myAddress — 연결된 지갑 주소 (내 행 하이라이트)
 * @param {boolean} loading
 */
function RankingCard({ title, icon, valueLabel, rows, renderValue, myAddress, loading }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>
        <span className={styles.cardIcon}>{icon}</span>
        {title}
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.rankCol}>순위</th>
            <th>주소</th>
            <th className={styles.valueCol}>{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={3} className={styles.emptyCell}>
                불러오는 중…
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={3} className={styles.emptyCell}>
                아직 기록이 없습니다.
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((row) => {
              const isMe =
                myAddress && row.userAddress?.toLowerCase() === myAddress.toLowerCase();
              return (
                <tr key={`${row.rank}-${row.userAddress}`} className={isMe ? styles.myRow : ''}>
                  <td className={styles.rankCol}>
                    {RANK_MEDAL[row.rank] ?? <span className={styles.rankNum}>{row.rank}</span>}
                  </td>
                  <td className={styles.addrCell}>
                    {shortenAddress(row.userAddress)}
                    {isMe && <span className={styles.meBadge}>나</span>}
                  </td>
                  <td className={styles.valueCol}>{renderValue(row)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

export default function Ranking({ address, onConnect }) {
  const [ranking, setRanking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    fetchRanking(10)
      .then((data) => {
        if (cancelled) return;
        setLoading(false);
        setError(null);
        setRanking(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.page}>
      <Header address={address} onConnect={onConnect} />

      <div className={styles.inner}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>🏆 명예의 전당</h1>
          <span className="cf-cap">CatForge 최강의 집사들</span>
        </div>

        {error && (
          <div style={{ color: 'var(--fail)', fontSize: 14, marginBottom: 16 }}>⚠ {error}</div>
        )}

        {!error && (
          <div className={styles.grid}>
            <RankingCard
              title="최고 단계"
              icon="⚔️"
              valueLabel="레벨"
              rows={ranking?.topItems ?? []}
              renderValue={(row) => (
                <>
                  <span className={styles.levelValue}>Lv.{row.totalLevel}</span>
                  <span className={styles.levelDetail}>
                    #{row.itemId} ({row.baseLevel}+{row.extraLevel})
                  </span>
                </>
              )}
              myAddress={address}
              loading={loading}
            />
            <RankingCard
              title="도전왕"
              icon="🔥"
              valueLabel="시도"
              rows={ranking?.topChallengers ?? []}
              renderValue={(row) => `${row.attempts.toLocaleString()}회`}
              myAddress={address}
              loading={loading}
            />
            <RankingCard
              title="성공왕"
              icon="✨"
              valueLabel="성공"
              rows={ranking?.topSuccess ?? []}
              renderValue={(row) => `${row.successes.toLocaleString()}회`}
              myAddress={address}
              loading={loading}
            />
          </div>
        )}

        {/* NFT 발급자 목록 — 백엔드 API 완성 후 추가 예정 */}
      </div>
    </div>
  );
}
