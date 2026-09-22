import styles from './Button.module.css';

export default function Button({
  children,
  variant = 'primary',
  tone = 'brand',
  type = 'button',
  size = 'md',
  block = false,
  className = '',
  ...rest
}) {
  const classes = [styles.button, styles[variant], styles[`tone-${tone}`], size === 'lg' ? styles.lg : '', block ? styles.block : '', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
