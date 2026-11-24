import { Loader } from "lucide-react";
import { useState } from "react";
import type { AcpToolCall } from "../acp/types";
import { pluralize } from "../lib/pluralize";
import { Collapsible } from "./Collapsible";
import { ToolCallItem } from "./ToolCallItem";
import styles from "./AgentSteps.module.css";

export interface AgentStepsProps {
    toolCalls: AcpToolCall[];
    autoOpen?: boolean;
    cwd: string;
}

export function AgentSteps({
    toolCalls,
    autoOpen = false,
    cwd,
}: AgentStepsProps) {
    const [manualOpen, setManualOpen] = useState<boolean | null>(null);

    if (toolCalls.length === 0) {
        return null;
    }

    const isOpen = manualOpen ?? autoOpen;
    const isRunning = toolCalls.some(
        (item) => item.status === "pending" || item.status === "in_progress",
    );
    const titleText = isRunning
        ? getRunningTitle(toolCalls)
        : `Выполнил ${pluralize(toolCalls.length, ["действие", "действия", "действий"])}`;

    const header = (
        <div className={styles.headerLeft}>
            <span className={styles.headerTitle}>{titleText}</span>
            {isRunning && (
                <span className={styles.liveBadge}>
                    <Loader className={styles.liveSpinner} size={11} />
                    работает
                </span>
            )}
        </div>
    );

    return (
        <Collapsible
            isOpen={isOpen}
            onToggle={() => setManualOpen(!isOpen)}
            header={header}
            className={styles.container}
            bodyClassName={styles.body}
        >
            <div className={styles.toolList}>
                {toolCalls.map((toolCall) => (
                    <ToolCallItem
                        key={toolCall.toolCallId}
                        toolCall={toolCall}
                        cwd={cwd}
                    />
                ))}
            </div>
        </Collapsible>
    );
}

function getRunningTitle(toolCalls: AcpToolCall[]): string {
    for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
        const item = toolCalls[index];

        if (item && (item.status === "in_progress" || item.status === "pending")) {
            return item.title?.trim() || "Выполняю действие...";
        }
    }

    return "Выполняю действие...";
}
