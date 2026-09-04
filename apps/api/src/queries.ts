import type {
  Batch,
  BatchProgress,
  BatchWithProgress,
  UrlCheck,
} from "@url-checker/contracts";
import { pool } from "./db";

function toUrlCheck(row: any): UrlCheck {
  return {
    id: row.id,
    batchId: row.batch_id,
    url: row.url,
    status: row.status,
    httpStatus: row.http_status,
    responseMs: row.response_ms,
    pageTitle: row.page_title,
    error: row.error,
    attemptCount: row.attempt_count,
    runNumber: row.run_number,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toBatch(row: any): Batch {
  return {
    id: row.id,
    status: row.status,
    totalUrls: row.total_urls,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const EMPTY_PROGRESS: BatchProgress = {
  total: 0,
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
};

export async function getBatchProgress(
  batchId: string,
): Promise<BatchProgress> {
  const { rows } = await pool.query(
    `SELECT status, count(*)::int AS count
    FROM url_checks WHERE batch_id = $1 GROUP BY status`,
    [batchId],
  );

  const progress = { ...EMPTY_PROGRESS };

  for (const row of rows) {
    progress[row.status as keyof BatchProgress] = row.count;
    progress.total += row.count;
  }

  return progress;
}

export async function getBatch(
  batchId: string,
): Promise<BatchWithProgress | null> {
  const { rows } = await pool.query(`SELECT * FROM batches WHERE id = $1`, [
    batchId,
  ]);

  if (rows.length === 0) {
    return null;
  }

  return {
    ...toBatch(rows[0]),
    progress: await getBatchProgress(batchId),
  };
}

export async function getChecks(batchId: string): Promise<UrlCheck[]> {
  const { rows } = await pool.query(
    `SELECT * FROM url_checks WHERE batch_id = $1 ORDER BY created_at, id`,
    [batchId],
  );

  return rows.map(toUrlCheck);
}

export async function getCheck(checkId: string): Promise<UrlCheck | null> {
  const { rows } = await pool.query(`SELECT * FROM url_checks WHERE id = $1`, [
    checkId,
  ]);

  return rows.length > 0 ? toUrlCheck(rows[0]) : null;
}

export async function listBatches(): Promise<BatchWithProgress[]> {
  const { rows } = await pool.query(
    `
    SELECT b.*,
        coalesce(jsonb_object_agg(u.status, u.count)
        FILTER (WHERE u.status IS NOT NULL), '{}'::jsonb) AS counts
    FROM batches b
    LEFT JOIN (
      SELECT batch_id, status, count(*)::int AS count
      FROM url_checks GROUP BY batch_id, status
    ) u ON u.batch_id = b.id
    GROUP BY b.id
    ORDER BY b.created_at DESC
    LIMIT 100`,
  );

  return rows.map((row) => {
    const progress = { ...EMPTY_PROGRESS, ...row.counts } as BatchProgress;
    progress.total = Object.entries(row.counts).reduce(
      (sum, [, n]) => sum + (n as number),
      0,
    );

    return { ...toBatch(row), progress };
  });
}
