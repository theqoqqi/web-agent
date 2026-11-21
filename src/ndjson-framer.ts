import { StringDecoder } from "node:string_decoder";

export class NdjsonLineDecoder {
    private readonly maxLineBytes: number;
    private decoder: StringDecoder;
    private buffer: string;

    public constructor(maxLineBytes: number = 16 * 1024 * 1024) {
        if (!Number.isInteger(maxLineBytes) || maxLineBytes <= 0) {
            throw new Error("maxLineBytes must be a positive integer");
        }
        this.maxLineBytes = maxLineBytes;
        this.decoder = new StringDecoder("utf8");
        this.buffer = "";
    }

    public push(chunk: Buffer): string[] {
        const decoded = this.decoder.write(chunk);
        return this.consumeDecoded(decoded);
    }

    public flush(): string[] {
        const tail = this.buffer + this.decoder.end();
        this.reset();
        const normalized = stripTrailingCarriageReturn(tail);
        if (normalized.trim().length === 0) {
            return [];
        }
        this.assertWithinLimit(normalized);
        return [
            normalized,
        ];
    }

    private consumeDecoded(decoded: string): string[] {
        const lines: string[] = [];
        let start = 0;

        while (true) {
            const newlineIndex = decoded.indexOf("\n", start);
            if (newlineIndex === -1) {
                this.buffer += decoded.slice(start);
                this.assertWithinLimit(this.buffer);
                return lines;
            }

            const segment = decoded.slice(start, newlineIndex);
            const rawLine = this.buffer + segment;
            this.buffer = "";
            const line = stripTrailingCarriageReturn(rawLine);

            if (line.trim().length > 0) {
                this.assertWithinLimit(line);
                lines.push(line);
            }

            start = newlineIndex + 1;
        }
    }

    private assertWithinLimit(text: string): void {
        if (Buffer.byteLength(text, "utf8") > this.maxLineBytes) {
            this.reset();
            throw new Error(`NDJSON line exceeds maxLineBytes (${this.maxLineBytes})`);
        }
    }

    private reset(): void {
        this.buffer = "";
        this.decoder = new StringDecoder("utf8");
    }
}

function stripTrailingCarriageReturn(line: string): string {
    return line.endsWith("\r") ? line.slice(0, -1) : line;
}
