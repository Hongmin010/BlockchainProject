import styles from './CharacterStage.module.css';

export default function CharacterStage({ level = 1, size = 360, showBadge = true }) {
  return (
    <div className={styles.stage} style={{ width: size, height: size }}>
      {showBadge && (
        <div className={styles.badge}>
          <span className={styles.badgeLabel}>LV.</span>
          {level}
        </div>
      )}
    </div>
  );
}
