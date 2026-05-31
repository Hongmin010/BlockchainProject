import styles from './StageBar.module.css';

export default function StageBar({ current = 1, max = 5 }) {
  return (
    <div className={styles.stages}>
      {Array.from({ length: max }).map((_, i) => {
        const n = i + 1;
        let pipClass = styles.pip;
        if (n <= current) pipClass += ` ${styles.done}`;
        else if (n === current + 1) pipClass += ` ${styles.next}`;
        else pipClass += ` ${styles.locked}`;

        return (
          <span key={n} className={pipClass}>
            {n}
          </span>
        );
      })}
    </div>
  );
}
