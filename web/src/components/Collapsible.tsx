import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./Collapsible.module.css";

export interface CollapsibleProps {
    isOpen: boolean;
    onToggle: () => void;
    header: ReactNode;
    children?: ReactNode;
    className?: string;
    bodyClassName?: string;
    disabled?: boolean;
    showChevron?: boolean;
    variant?: "card" | "flat";
}

export function Collapsible({
    isOpen,
    onToggle,
    header,
    children,
    className,
    bodyClassName,
    disabled = false,
    showChevron = true,
    variant = "card",
}: CollapsibleProps) {
    const rootClassName = [
        styles.root,
        styles[variant],
        disabled ? styles.disabled : "",
        className ?? "",
    ]
        .filter(Boolean)
        .join(" ");

    const chevronClassName = [
        styles.chevron,
        isOpen ? styles.chevronOpen : "",
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <div className={rootClassName}>
            {disabled ? (
                <div className={styles.trigger}>
                    <span className={styles.headerContent}>{header}</span>
                </div>
            ) : (
                <button
                    type="button"
                    className={styles.trigger}
                    onClick={onToggle}
                    aria-expanded={isOpen}
                >
                    <span className={styles.headerContent}>{header}</span>

                    {showChevron && (
                        <ChevronDown className={chevronClassName} size={14} />
                    )}
                </button>
            )}

            {isOpen && !disabled && (
                <div className={[styles.body, bodyClassName ?? ""].filter(Boolean).join(" ")}>
                    {children}
                </div>
            )}
        </div>
    );
}
