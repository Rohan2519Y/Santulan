import styles from './Card.module.css';

const TONES = ['blue', 'green', 'sky', 'cream', 'lavender', 'pink'];

/** `tone` picks one of the measured tints (design-system §1.1); omitted = the default surface. */
export default function Card({ children, className = '', as: Tag = 'div', tone, ...rest }) {
  const toneClass = TONES.includes(tone) ? styles[`tone-${tone}`] : '';
  return (
    <Tag className={`${styles.card} ${toneClass} ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}
