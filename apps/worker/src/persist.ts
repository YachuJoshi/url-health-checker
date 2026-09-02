import { pool } from "./db";
import type { CheckResult } from "./check-url";

/**
 * Every write is conditional on run_number. A worker still in flight from a
 * previous run will match zero rows once "retry failed only" has bumped the
 * counter and its stale result is silently discarded.
 */
export async function markCheckAsRunning(
  checkId: string,
  runNumber: number,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE url_checks
      SET status = 'running', attempt_count = attempt_count + 1, updated_at = now()
      WHERE id = $1 AND run_number = $2 AND status IN ('queued', 'running')
    `,
    [checkId, runNumber],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function persistSuccess(
  checkId: string,
  runNumber: number,
  result: Extract<CheckResult, { type: "success" }>,
): Promise<boolean> {
  const updated = await pool.query(
    `UPDATE url_checks
     SET status = 'succeeded',
         http_status = $3, response_ms = $4, page_title = $5,
         error = NULL, updated_at = now()
     WHERE id = $1 AND run_number = $2 AND status = 'running'`,
    [
      checkId,
      runNumber,
      result.httpStatus,
      result.responseMs,
      result.pageTitle,
    ],
  );

  return (updated.rowCount ?? 0) > 0;
}

export async function persistFailure(
  checkId: string,
  runNumber: number,
  error: string,
): Promise<boolean> {
  const updated = await pool.query(
    `UPDATE url_checks
     SET status = 'failed', error = $3,
         http_status = NULL, response_ms = NULL, page_title = NULL,
         updated_at = now()
     WHERE id = $1 AND run_number = $2 AND status = 'running'`,
    [checkId, runNumber, error],
  );

  return (updated.rowCount ?? 0) > 0;
}

/**
 * Promotes a batch to 'running' on first activity, and to 'completed' once no
 * children remain in flight. Cancelled batches are never promoted & cancellation is terminal.
 */
export async function refreshBatchStatus(batchId: string): Promise<void> {
  await pool.query(
    `UPDATE batches b
    SET status = CASE 
        WHEN NOT EXISTS (
          SELECT 1 FROM url_checks u
          WHERE u.batch_id = b.id AND u.status IN ('queued', 'running')
        ) THEN 'completed'::batch_status
        ELSE 'running'::batch_status
      END,
      updated_at = now()
    WHERE b.id = $1 AND b.status <> 'cancelled'
    `,
    [batchId],
  );
}
