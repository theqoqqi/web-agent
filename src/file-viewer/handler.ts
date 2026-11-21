import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BridgeConfig } from "../config.js";
import { FileViewerError, readFileTarget } from "./file-reader.js";
import { buildContentDisposition, parseFileViewerQuery } from "./path-utils.js";
import { getViewerAsset, renderErrorPage, renderFilePage } from "./render-html.js";

const VIEWER_CSP = [
    "default-src 'none'",
    "style-src 'self'",
    "script-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
].join("; ");

const ASSETS_PREFIX = "/files/assets/";

export interface HttpLogger {
    error: (message: string) => void;
}

export async function handleFileViewerRequest(
    req: IncomingMessage,
    res: ServerResponse,
    config: BridgeConfig,
    logger: HttpLogger,
): Promise<boolean> {
    const pathname = extractRequestPathname(req.url);

    if (pathname.startsWith(ASSETS_PREFIX)) {
        await handleAssetRequest(req, res, pathname.slice(ASSETS_PREFIX.length));
        return true;
    }

    if (pathname !== "/files" && pathname !== "/files/") {
        return false;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
        sendHtml(
            res,
            405,
            renderErrorPage(405, "Method not allowed"),
            req.method === "HEAD",
            {
                Allow: "GET, HEAD",
            },
        );
        return true;
    }

    try {
        const query = parseFileViewerQuery(req.url ?? "/files", config.defaultCwd);
        const result = await readFileTarget(query.targetPath, query.mode, {
            maxFileBytes: config.maxFileBytes,
            snippetBytes: config.viewerSnippetBytes,
        });

        const isHead = req.method === "HEAD";

        if (result.kind === "download") {
            sendFileDownload(res, result.resolvedPath, result.size, isHead, logger);
            return true;
        }

        if (query.mode === "raw" && result.kind === "text") {
            sendPlainText(res, 200, result.content, isHead);
            return true;
        }

        sendHtml(res, 200, renderFilePage(result), isHead);
    } catch (error) {
        if (error instanceof FileViewerError) {
            sendHtml(
                res,
                error.statusCode,
                renderErrorPage(error.statusCode, error.message),
                req.method === "HEAD",
            );
            return true;
        }

        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("path") || message.includes("NUL")) {
            sendHtml(res, 400, renderErrorPage(400, message), req.method === "HEAD");
            return true;
        }

        logger.error(`[file-viewer] Unexpected error: ${message}`);
        sendHtml(
            res,
            500,
            renderErrorPage(500, "Internal server error"),
            req.method === "HEAD",
        );
    }

    return true;
}

async function handleAssetRequest(
    req: IncomingMessage,
    res: ServerResponse,
    assetName: string,
): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
        sendHtml(
            res,
            405,
            renderErrorPage(405, "Method not allowed"),
            req.method === "HEAD",
            {
                Allow: "GET, HEAD",
            },
        );
        return;
    }

    const asset = await getViewerAsset(assetName);
    if (!asset) {
        sendHtml(res, 404, renderErrorPage(404, "Asset not found"), req.method === "HEAD");
        return;
    }

    res.writeHead(200, {
        "Content-Type": asset.contentType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=300",
    });
    res.end(req.method === "HEAD" ? undefined : asset.body);
}

function sendFileDownload(
    res: ServerResponse,
    filePath: string,
    size: number,
    isHead: boolean,
    logger: HttpLogger,
): void {
    res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(size),
        "Content-Disposition": buildContentDisposition(filePath),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
    });

    if (isHead) {
        res.end();
        return;
    }

    const stream = createReadStream(filePath);
    stream.on("error", (error) => {
        logger.error(`[file-viewer] Download stream error: ${error.message}`);
        if (!res.headersSent) {
            sendHtml(res, 500, renderErrorPage(500, "Failed to read file"), false);
        } else {
            res.destroy(error);
        }
    });
    res.on("close", () => {
        if (!stream.destroyed) {
            stream.destroy();
        }
    });
    stream.pipe(res);
}

function sendPlainText(
    res: ServerResponse,
    statusCode: number,
    text: string,
    isHead: boolean,
): void {
    res.writeHead(statusCode, {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
    });
    res.end(isHead ? undefined : text);
}

function sendHtml(
    res: ServerResponse,
    statusCode: number,
    html: string,
    isHead: boolean,
    extraHeaders: Record<string, string> = {},
): void {
    res.writeHead(statusCode, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": VIEWER_CSP,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        ...extraHeaders,
    });
    res.end(isHead ? undefined : html);
}

function extractRequestPathname(rawUrl: string | undefined): string {
    try {
        return new URL(rawUrl ?? "/", "http://127.0.0.1").pathname;
    } catch {
        return "/";
    }
}
