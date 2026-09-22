import { Link } from 'react-router-dom';
import ImageSlot from '../ImageSlot/ImageSlot';
import styles from './Logo.module.css';

/** Lotus mark (a picture slot) + SANTULAN wordmark and tagline, as in every sample header. The wordmark is real text. */
export default function Logo({ to = '/', size = 'md' }) {
  return (
    <Link to={to} className={`${styles.logo} ${styles[size] || ''}`.trim()} aria-label="Santulan home">
      <ImageSlot slot="logoMark" className={styles.mark} />
      <span className={styles.word} aria-hidden="true">
        <span className={styles.name}>SANTULAN</span>
        <span className={styles.tag}>Understand · Grow · Thrive</span>
      </span>
    </Link>
  );
}
