import styles from './StageBar.module.css';

export default function StageBar({
  current = 1,
  max = 5,
  variant = 'normal',
  compact = false,
  labelOffset = 0, // 칩 표시 숫자에 더할 값 (상급 바를 6~20으로 보이게)
}) {
  const isDone = (n) => n <= current;
  const isNext = (n) => n === current + 1;

  return (
    <div className={`${styles.stages} ${compact ? styles.stagesCompact : ''}`}>
      {Array.from({ length: max }).map((_, i) => {
        const n = i + 1;
        let pipClass = styles.pip;
        if (isDone(n)) {
          pipClass += variant === 'advanced' ? ` ${styles.advancedDone}` : ` ${styles.done}`;
        } else if (isNext(n)) {
          pipClass += variant === 'advanced' ? ` ${styles.advancedNext}` : ` ${styles.next}`;
        } else {
          pipClass += ` ${styles.locked}`;
        }
        return (
          <span key={n} className={pipClass}>
            {n + labelOffset}
          </span>
        );
      })}
    </div>
  );
}
