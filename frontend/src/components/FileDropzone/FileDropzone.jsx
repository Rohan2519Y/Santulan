import { useId, useState } from 'react';
import { UploadCloud, FileSpreadsheet } from 'lucide-react';
import styles from './FileDropzone.module.css';

/**
 * Drag-and-drop or browse. The real <input type="file"> stays in the DOM (visually hidden), so
 * it is keyboard- and screen-reader-operable; the label is the drop target and shows focus.
 */
export default function FileDropzone({ accept, onFile, busy = false, disabled = false, title = 'Drop a file here, or browse', hint, selectedName }) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const inactive = busy || disabled;

  const pick = (file) => {
    if (file && !inactive) onFile(file);
  };

  return (
    <label
      htmlFor={inputId}
      className={`${styles.zone} ${dragging ? styles.dragging : ''} ${inactive ? styles.inactive : ''}`.trim()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!inactive) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pick(e.dataTransfer.files && e.dataTransfer.files[0]);
      }}
    >
      {selectedName ? <FileSpreadsheet size={32} aria-hidden="true" /> : <UploadCloud size={32} aria-hidden="true" />}
      <span className={styles.title}>{busy ? 'Uploading…' : selectedName || title}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
      <input
        id={inputId}
        className="sr-only"
        type="file"
        accept={accept}
        disabled={inactive}
        onChange={(e) => {
          pick(e.target.files && e.target.files[0]);
          e.target.value = ''; // the same file can be chosen again
        }}
      />
    </label>
  );
}
