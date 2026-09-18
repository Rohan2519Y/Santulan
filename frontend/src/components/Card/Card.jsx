import styles from './Card.module.css';

export default function Card({ children, className = '', as: Tag = 'div', ...rest }) {
  return (
    <Tag className={`${styles.card} ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}
