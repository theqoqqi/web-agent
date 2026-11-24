import { Check, Loader, X } from "lucide-react";
import { useState } from "react";
import type { AcpToolCall, AcpToolCallStatus } from "../acp/types";
import { resolveLocationToViewerUrl } from "../lib/file-links";
import { Collapsible } from "./Collapsible";
import styles from "./ToolCallItem.module.css";

export interface ToolCallItemProps {
    toolCall: AcpToolCall;
    cwd: string;
}

export function ToolCallItem({ toolCall, cwd }: ToolCallItemProps) {
    const [isOpen, setIsOpen] = useState(false);
    const detailsText = formatToolDetails(toolCall);
    const hasDetails = detailsText.length > 0;
    const status: AcpToolCallStatus = toolCall.status ?? "pending";
    const locations = toolCall.locations ?? [];

    const locationsNode =
        locations.length > 0 ? (
            <div className={styles.locations}>
                {locations.map((loc, index) => {
                    const url = resolveLocationToViewerUrl(loc.path, loc.line, cwd);
                    const label = formatLocationLabel(loc.path, loc.line);

                    if (!url) {
                        return (
                            <span key={`${loc.path}-${index}`} className={styles.locationText}>
                                {label}
                            </span>
                        );
                    }

                    return (
                        <a
                            key={`${loc.path}-${index}`}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={loc.path}
                            className={styles.locationLink}
                        >
                            {label}
                        </a>
                    );
                })}
            </div>
        ) : null;

    const header = (
        <div className={styles.toolItem}>
            <span className={styles.statusIcon}>{renderStatusIcon(status)}</span>
            <div className={styles.info}>
                <span className={styles.title}>
                    {toolCall.title?.trim() || toolCall.kind || toolCall.toolCallId}
                </span>
                {!hasDetails && locationsNode}
            </div>
            <span className={styles.summary}>{formatStatusLabel(status)}</span>
        </div>
    );

    return (
        <div>
            <Collapsible
                variant="flat"
                isOpen={isOpen}
                onToggle={() => setIsOpen((prev) => !prev)}
                header={header}
                bodyClassName={styles.body}
                disabled={!hasDetails}
                showChevron={hasDetails}
            >
                {hasDetails && <pre className={styles.detailsBox}>{detailsText}</pre>}
            </Collapsible>
            {hasDetails && locationsNode && <div className={styles.body}>{locationsNode}</div>}
        </div>
    );
}

function renderStatusIcon(status: AcpToolCallStatus) {
    if (status === "completed") {
        return <Check className={styles.statusSuccess} size={15} />;
    }

    if (status === "failed") {
        return <X className={styles.statusFailed} size={15} />;
    }

    return <Loader className={styles.statusSpinner} size={15} />;
}

function formatStatusLabel(status: AcpToolCallStatus): string {
    switch (status) {
        case "completed":
            return "готово";
        case "failed":
            return "ошибка";
        case "in_progress":
            return "выполняется";
        default:
            return "ожидает";
    }
}

function formatLocationLabel(filePath: string, line?: number): string {
    const cleanPath = filePath.replace(/^file:\/\//i, "");
    const parts = cleanPath.split(/[\\/]/).filter(Boolean);
    const name = parts[parts.length - 1] ?? cleanPath;

    return line !== undefined ? `${name}:${line}` : name;
}

function formatToolDetails(toolCall: AcpToolCall): string {
    const blocks: string[] = [];

    if (Array.isArray(toolCall.content)) {
        for (const entry of toolCall.content) {
            const text = extractContentText(entry);
            if (text) {
                blocks.push(text);
            }
        }
    }

    if (blocks.length === 0 && toolCall.rawInput !== undefined) {
        blocks.push(stringifyPreview(toolCall.rawInput));
    }

    if (toolCall.rawOutput !== undefined) {
        blocks.push(stringifyPreview(toolCall.rawOutput));
    }

    return blocks.join("\n\n").trim();
}

function extractContentText(entry: unknown): string {
    if (typeof entry === "string") {
        return entry;
    }

    if (typeof entry !== "object" || entry === null) {
        return "";
    }

    const record = entry as Record<string, unknown>;

    if (typeof record.text === "string") {
        return record.text;
    }

    if (typeof record.content === "object" && record.content !== null) {
        const inner = record.content as Record<string, unknown>;
        if (typeof inner.text === "string") {
            return inner.text;
        }
    }

    if (record.type === "diff" && typeof record.path === "string") {
        const newText = typeof record.newText === "string" ? record.newText : "";
        return `diff ${record.path}\n${newText}`.trim();
    }

    return stringifyPreview(entry);
}

function stringifyPreview(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}
