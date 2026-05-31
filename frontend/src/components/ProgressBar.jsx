import styles from './ProgressBar.module.css';

export default function ProgressBar({ value = 0, height = 8, animated = false }) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className={styles.wrap} style={{ height }}>
      <div
        className={`${styles.fill} ${animated ? styles.animated : ''}`}
        style={{ width: `${clamped}%` }}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}
