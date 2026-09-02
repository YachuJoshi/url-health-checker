import * as cheerio from "cheerio";

const REQUEST_TIMEOUT_MS = 10_000;

/** Maximum number of bytes to read from the response body.
 * Enough to contain <head> on essentially any page.
 */
const MAX_BODY_BYTES = 512 * 1024; // 512 KiB

export interface CheckSuccess {
  type: "success";
  httpStatus: number;
  responseMs: number;
  pageTitle: string | null;
}

export interface CheckFailure {
  type: "failure";
  error: string;
  retryable: boolean;
}

export type CheckResult = CheckSuccess | CheckFailure;

export async function checkUrl(
  url: string,
  signal: AbortSignal,
): Promise<CheckResult> {
  const startedAt = Date.now();
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = AbortSignal.any([signal, timeout]);

  let response: Response;

  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: combined,
      headers: { "User-Agent": "url-health-checker/1.0" },
    });
  } catch (err) {
    // DNS failures, network errors, refused connection, timeout, abort etc
    const message = err instanceof Error ? err.message : String(err);

    return {
      type: "failure",
      error: message,
      retryable: !signal.aborted, // If the request was aborted, we don't want to retry, as it was likely a cancellation.
    };
  }

  const responseMs = Date.now() - startedAt;
  const contentType = response.headers.get("content-type") || "";

  let pageTitle: string | null = null;

  if (contentType.includes("text/html") && response.body) {
    pageTitle = await extractPageTitle(response.body);
  } else {
    await response.body?.cancel(); // Discard the body if we don't need it
  }

  return {
    type: "success",
    httpStatus: response.status,
    responseMs,
    pageTitle,
  };
}

async function extractPageTitle(
  body: ReadableStream<Uint8Array>,
): Promise<string | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");

  let html = "";
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      bytes += value.length;
      html += decoder.decode(value, { stream: true });

      // Stop reading if we find the closing </head> tag or exceed the max body size
      if (html.includes("</head>") || bytes >= MAX_BODY_BYTES) {
        break;
      }
    }
  } catch (err) {
    return null;
  } finally {
    await reader.cancel().catch(() => {}); // Ignore errors on cancel
  }

  const title = cheerio.load(html)("title").first().text().trim();
  return title.length > 0 ? title : null;
}
