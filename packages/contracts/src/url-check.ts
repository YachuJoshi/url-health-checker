export const CHECK_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type CheckStatus = (typeof CHECK_STATUSES)[number];

export interface UrlCheck {
  id: string;
  batchId: string;
  url: string;
  status: CheckStatus;
  httpStatus: number | null;
  responseMs: number | null;
  pageTitle: string | null;
  error: string | null;
  attemptCount: number;
  runNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface UrlCheckJobPayload {
  checkId: string;
  batchId: string;
  url: string;
  runNumber: number;
}
