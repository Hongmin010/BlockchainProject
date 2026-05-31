import styles from './Badge.module.css';

export default function Badge({
  variant = 'default',
  dot = false,
  className = '',
  children,
  ...rest
}) {
  const cls = [styles.badge, styles[variant], dot && styles.dot, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
