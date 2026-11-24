import { CircleAlert } from "lucide-react";
import styles from "./ErrorMessage.module.css";

export interface ErrorMessageProps {
    message: string;
    isAuthError?: boolean;
}

export function ErrorMessage({
    message,
    isAuthError = false,
}: ErrorMessageProps) {
    return (
        <div className={styles.error} role="alert">
            <CircleAlert className={styles.icon} size={16} />
            <div className={styles.content}>
                <span>{message}</span>
                {isAuthError && (
                    <span className={styles.hint}>
                        Проверь авторизацию агента на сервере (вход / учётные данные agy acp по SSH).
                    </span>
                )}
            </div>
        </div>
    );
}
