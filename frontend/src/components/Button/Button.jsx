import styles from './Button.module.css';

export default function Button({
  children,
  variant = 'primary',
  tone = 'brand',
  type = 'button',
  className = '',
  ...rest
}) {
  const classes = [styles.button, styles[variant], styles[`tone-${tone}`], className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
