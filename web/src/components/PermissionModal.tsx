import { ShieldAlert } from "lucide-react";
import type { AcpPermissionResponse } from "../acp/types";
import type { PendingPermissionItem } from "../acp/session-reducer";
import { resolveLocationToViewerUrl } from "../lib/file-links";
import styles from "./PermissionModal.module.css";

export interface PermissionModalProps {
    item: PendingPermissionItem | null;
    cwd: string;
    onRespond: (id: string, response: AcpPermissionResponse) => void;
}

export function PermissionModal({
    item,
    cwd,
    onRespond,
}: PermissionModalProps) {
    if (!item) {
        return null;
    }

    const { toolCall, options } = item.params;
    const locations = toolCall.locations ?? [];
    const inputPreview = toolCall.rawInput !== undefined ? formatPreview(toolCall.rawInput) : "";

    return (
        <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Подтверждение действия">
            <div className={styles.dialog}>
                <div className={styles.titleRow}>
                    <ShieldAlert className={styles.icon} size={18} />
                    <h2 className={styles.heading}>Требуется подтверждение</h2>
                </div>

                <p className={styles.toolTitle}>
                    {toolCall.title?.trim() || toolCall.kind || toolCall.toolCallId}
                </p>

                {locations.length > 0 && (
                    <div className={styles.locations}>
                        {locations.map((loc, index) => {
                            const url = resolveLocationToViewerUrl(loc.path, loc.line, cwd);
                            const label = loc.line !== undefined ? `${loc.path}:${loc.line}` : loc.path;

                            if (!url) {
                                return <span key={`${loc.path}-${index}`}>{label}</span>;
                            }

                            return (
                                <a
                                    key={`${loc.path}-${index}`}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={styles.locationLink}
                                >
                                    {label}
                                </a>
                            );
                        })}
                    </div>
                )}

                {inputPreview.length > 0 && (
                    <pre className={styles.rawPreview}>{inputPreview}</pre>
                )}

                <div className={styles.actions}>
                    <button
                        type="button"
                        className={styles.cancelBtn}
                        onClick={() =>
                            onRespond(item.id, {
                                outcome: {
                                    outcome: "cancelled",
                                },
                            })
                        }
                    >
                        Отмена
                    </button>

                    {options.map((opt) => {
                        const isAllow = opt.kind?.startsWith("allow") ?? false;

                        return (
                            <button
                                key={opt.optionId}
                                type="button"
                                className={[styles.optionBtn, isAllow ? styles.primaryOption : ""]
                                    .filter(Boolean)
                                    .join(" ")}
                                onClick={() =>
                                    onRespond(item.id, {
                                        outcome: {
                                            outcome: "selected",
                                            optionId: opt.optionId,
                                        },
                                    })
                                }
                            >
                                {opt.name}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function formatPreview(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}
