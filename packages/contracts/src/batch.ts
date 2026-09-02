export const BATCH_STATUSES = [
  "pending",
  "running",
  "completed",
  "cancelled",
] as const;

export type BatchStatus = (typeof BATCH_STATUSES)[number];

export interface Batch {
  id: string;
  status: BatchStatus;
  totalUrls: number;
  createdAt: string;
  updatedAt: string;
}

/** Derived counts — never stored, always computed from url_checks. */
export interface BatchProgress {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
}

export interface BatchWithProgress extends Batch {
  progress: BatchProgress;
}
