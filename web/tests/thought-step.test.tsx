import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AgentSteps } from "../src/components/AgentSteps";

describe("ThoughtStepItem inside AgentSteps", () => {
    test("когда блок размышлений свернут, отображает первую непустую строку, а при разворачивании — Размышления", () => {
        const items = [
            {
                kind: "thought" as const,
                id: "t-1",
                text: "  \n\nПервая строка размышлений модели\nВторая строка подробных мыслей",
            },
        ];

        render(
            <AgentSteps
                items={items}
                isGenerating={true}
                cwd="/srv"
            />,
        );

        const collapsedBtn = screen.getByRole("button", {
            name: "Первая строка размышлений модели",
        });
        expect(collapsedBtn).toBeInTheDocument();
        expect(collapsedBtn).toHaveAttribute("aria-expanded", "false");

        const titleSpan = screen.getByTitle("Первая строка размышлений модели");
        expect(titleSpan).toBeInTheDocument();

        fireEvent.click(collapsedBtn);

        const expandedBtn = screen.getByRole("button", {
            name: "Размышления",
        });
        expect(expandedBtn).toBeInTheDocument();
        expect(expandedBtn).toHaveAttribute("aria-expanded", "true");

        expect(
            screen.getByText(/Вторая строка подробных мыслей/),
        ).toBeInTheDocument();

        fireEvent.click(expandedBtn);
        expect(
            screen.getByRole("button", {
                name: "Первая строка размышлений модели",
            }),
        ).toHaveAttribute("aria-expanded", "false");
    });

    test("если текст размышлений пустой или только пробелы, отображает Размышления в свернутом виде", () => {
        const items = [
            {
                kind: "thought" as const,
                id: "t-empty",
                text: "   \n\n  ",
            },
        ];

        render(
            <AgentSteps
                items={items}
                isGenerating={true}
                cwd="/srv"
            />,
        );

        const thoughtBtn = screen.getByRole("button", {
            name: "Размышления",
        });
        expect(thoughtBtn).toBeInTheDocument();
        expect(thoughtBtn).toHaveAttribute("aria-expanded", "false");
    });
});
