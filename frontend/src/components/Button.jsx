import styles from './Button.module.css';

export default function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  onClick,
  children,
  className = '',
  ...rest
}) {
  const cls = [styles.btn, styles[variant], styles[size], loading && styles.loading, className]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={cls} disabled={disabled || loading} onClick={onClick} {...rest}>
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}
