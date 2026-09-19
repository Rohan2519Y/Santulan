import styles from './PageHeader.module.css';

/** The one <h1> of a dashboard page, with an optional description and page-level actions. */
export default function PageHeader({ title, description, actions }) {
  return (
    <div className={styles.header}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
