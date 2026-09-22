import { IMAGE_SLOTS } from '../../assets/imageSlots';
import styles from './ImageSlot.module.css';

const SLOT_NUMBERS = Object.fromEntries(Object.keys(IMAGE_SLOTS).map((key, i) => [key, i + 1]));

/**
 * A picture area that stays WHITE until a path is filled in `assets/imageSlots.js`. The <img> is always rendered (empty until a
 * path exists) so the layout, the aspect and the mobile crop are already in place. A slot may hold a string or
 * { desktop, mobile }; the mobile picture is used below 640 px.
 *
 * `className` sets the size (height, aspect-ratio or absolute cover). Pictures are decorative: they carry an alt text only when
 * one is passed AND a picture exists, otherwise alt="" so assistive technology skips the empty area.
 *
 * While a slot is still empty, its number and key are shown as a small badge (same number as its position in
 * `assets/imageSlots.js`) so a picture can be matched to the right line just by looking at the page. The badge disappears the
 * moment a path is filled in.
 */
export default function ImageSlot({ slot, alt = '', className = '', fit = 'cover', position = 'center' }) {
  const entry = IMAGE_SLOTS[slot];
  const desktop = typeof entry === 'string' ? entry : (entry && entry.desktop) || '';
  const mobile = typeof entry === 'object' && entry ? entry.mobile || '' : '';
  const src = desktop || mobile;
  return (
    <div className={`${styles.slot} ${className}`.trim()} data-slot={slot} aria-hidden={src ? undefined : 'true'}>
      <picture>
        {mobile && desktop && <source media="(max-width: 639px)" srcSet={mobile} />}
        <img className={styles.img} src={src || undefined} alt={src ? alt : ''} loading="lazy" decoding="async" style={{ objectFit: fit, objectPosition: position }} />
      </picture>
      {!src && <span className={styles.badge}>{SLOT_NUMBERS[slot]} · {slot}</span>}
    </div>
  );
}
