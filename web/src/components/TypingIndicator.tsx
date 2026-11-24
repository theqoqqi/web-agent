import styles from "./TypingIndicator.module.css";

export function TypingIndicator() {
    return (
        <div className={styles.row} aria-label="Агент формирует ответ">
            <div className={styles.bubble}>
                <span className={styles.dot} />
                <span className={styles.dot} />
                <span className={styles.dot} />
            </div>
        </div>
    );
}
