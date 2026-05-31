import styles from './Card.module.css';

export default function Card({
  variant = 'default',
  padding,
  className = '',
  style = {},
  children,
  ...rest
}) {
  const cls = [styles.card, styles[variant], className].filter(Boolean).join(' ');

  const inlineStyle = padding !== undefined ? { padding, ...style } : style;

  return (
    <div className={cls} style={inlineStyle} {...rest}>
      {children}
    </div>
  );
}
