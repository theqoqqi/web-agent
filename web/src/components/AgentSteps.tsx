import { Loader } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentStepItem } from "../acp/session-reducer";
import type { AcpToolCall } from "../acp/types";
import { pluralize } from "../lib/pluralize";
import { Collapsible } from "./Collapsible";
import { ToolCallItem } from "./ToolCallItem";
import styles from "./AgentSteps.module.css";

export interface AgentStepsProps {
    items: AgentStepItem[];
    isGenerating: boolean;
    cwd: string;
}

export function AgentSteps({
    items,
    isGenerating,
    cwd,
}: AgentStepsProps) {
    const [manualOpen, setManualOpen] = useState<boolean | null>(null);
    const prevGeneratingRef = useRef(isGenerating);

    useEffect(() => {
        if (prevGeneratingRef.current && !isGenerating) {
            setManualOpen(null);
        }

        prevGeneratingRef.current = isGenerating;
    }, [isGenerating]);

    if (items.length === 0) {
        return null;
    }

    const isOpen = manualOpen ?? isGenerating;
    const toolCalls = items
        .filter((item): item is Extract<AgentStepItem, { kind: "tool_call" }> => item.kind === "tool_call")
        .map((item) => item.toolCall);
    const hasThought = items.some((item) => item.kind === "thought");
    const hasRunningTool = toolCalls.some(
        (item) => item.status === "pending" || item.status === "in_progress",
    );
    const isLive = isGenerating || hasRunningTool;
    const titleText = buildStepsTitle(toolCalls, hasThought, isGenerating, hasRunningTool);

    const header = (
        <div className={styles.headerLeft}>
            <span className={styles.headerTitle}>{titleText}</span>
            {isLive && (
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
                {items.map((item) =>
                    item.kind === "thought" ? (
                        <p key={item.id} className={styles.thoughtItem}>
                            {item.text}
                        </p>
                    ) : (
                        <ToolCallItem
                            key={item.toolCall.toolCallId}
                            toolCall={item.toolCall}
                            cwd={cwd}
                        />
                    ),
                )}
            </div>
        </Collapsible>
    );
}

function buildStepsTitle(
    toolCalls: AcpToolCall[],
    hasThought: boolean,
    isGenerating: boolean,
    hasRunningTool: boolean,
): string {
    if (hasRunningTool) {
        return getRunningTitle(toolCalls);
    }

    if (isGenerating) {
        return toolCalls.length > 0 ? "Выполняю действия..." : "Размышляет...";
    }

    if (toolCalls.length > 0 && hasThought) {
        return `Размышления и ${pluralize(toolCalls.length, ["действие", "действия", "действий"])}`;
    }

    if (toolCalls.length > 0) {
        return `Выполнил ${pluralize(toolCalls.length, ["действие", "действия", "действий"])}`;
    }

    return "Размышления";
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
