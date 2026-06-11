import styles from '../Game.module.css';
import { CAT_EMOJIS } from './constants';

// 보유 고양이 선택 목록 (로딩/에러/빈 상태 포함)
export default function CatList({ items, selectedItemId, onSelect, loading, error }) {
  return (
    <>
      {loading && (
        <div className={styles.catListEmpty}>고양이 목록 불러오는 중…</div>
      )}
      {!loading && items.length > 0 && (
        <div className={styles.catList}>
          {items.map((item) => {
            const iid = Number(item.itemId);
            const isSelected = iid === selectedItemId;
            return (
              <button
                key={iid}
                className={`${styles.catListItem} ${isSelected ? styles.catListItemSelected : ''}`}
                onClick={() => onSelect(iid)}
              >
                <span className={styles.catListEmoji}>
                  {CAT_EMOJIS[Math.min(item.totalLevel ?? item.level, CAT_EMOJIS.length - 1)]}
                </span>
                <span className={`${styles.catListMeta} ${isSelected ? styles.catListMetaSelected : ''}`}>
                  #{iid} · Lv.{item.totalLevel ?? item.level}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {!loading && error && (
        <div className={styles.catListEmpty}>⚠ 서버 연결 실패 — 백엔드 서버를 확인해주세요</div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className={styles.catListEmpty}>보유 고양이 없음 — NFT 민팅 후 이용해주세요</div>
      )}
    </>
  );
}
