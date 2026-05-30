import styles from "./Pagination.module.css";

export default function Pagination({ total, offset, limit, onChange }) {
  const currentStart = total === 0 ? 0 : offset + 1;
  const currentEnd = Math.min(offset + limit, total);

  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  const handlePrev = () => onChange(Math.max(0, offset - limit));
  const handleNext = () => onChange(offset + limit);

  return (
    <div className={styles.pagination}>
      <span className={styles.info}>
        第 {currentStart}-{currentEnd} 条，共 {total} 条
      </span>
      <button className={styles.btn} disabled={!hasPrev} onClick={handlePrev}>
        上一页
      </button>
      <button className={styles.btn} disabled={!hasNext} onClick={handleNext}>
        下一页
      </button>
    </div>
  );
}
