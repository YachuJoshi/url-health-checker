export interface ValidationResult {
  valid: string[];
  rejected: { url: string; reason: string }[];
}

/**
 * Validates a list of URLs, returning the valid ones and the rejected ones with reasons.
 */
export function validateUrls(raw: string[]): ValidationResult {
  const valid: string[] = [];
  const rejected: { url: string; reason: string }[] = [];

  for (const input of raw) {
    const trimmed = input.trim();

    if (!trimmed) {
      continue;
    }

    let parsed: URL;

    try {
      parsed = new URL(trimmed);
    } catch {
      rejected.push({ url: trimmed, reason: "Invalid URL" });
      continue;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      rejected.push({
        url: trimmed,
        reason: "Invalid protocol. Only http: and https: are allowed.",
      });

      continue;
    }

    valid.push(parsed.toString());
  }

  return { valid, rejected };
}
