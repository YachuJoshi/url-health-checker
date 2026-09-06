import type {
  BatchWithProgress,
  BatchDetail,
  CreateBatchRequest,
  CreateBatchResponse,
} from "@url-checker/contracts";

const API_URL =
  typeof window === "undefined"
    ? (process.env.API_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      "http://localhost:4000/api")
    : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api");

export async function listBatches(): Promise<BatchWithProgress[]> {
  const endpoint = `${API_URL}/batches`;
  const res = await fetch(endpoint, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`GET ${endpoint} failed: ${res.status}`);
  }

  return res.json() as Promise<BatchWithProgress[]>;
}

export async function getBatchDetail(id: string): Promise<BatchDetail | null> {
  const endpoint = `${API_URL}/batches/${id}`;
  const res = await fetch(endpoint, { cache: "no-store" });

  if (res.status === 400) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`GET ${endpoint} failed: ${res.status}`);
  }

  return res.json() as Promise<BatchDetail>;
}

export async function createBatch(
  payload: CreateBatchRequest,
): Promise<CreateBatchResponse> {
  const endpoint = `${API_URL}/batches`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error ?? `POST /batches failed: ${res.status}`);
  }

  return res.json() as Promise<CreateBatchResponse>;
}

export async function cancelBatch(id: string): Promise<{ cancelled: number }> {
  const endpoint = `${API_URL}/batches/${id}/cancel`;
  const res = await fetch(endpoint, { method: "POST" });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error ?? `POST ${endpoint} failed: ${res.status}`);
  }

  return res.json();
}

export async function retryFailedBatch(
  id: string,
): Promise<{ retried: number }> {
  const endpoint = `${API_URL}/batches/${id}/retry-failed`;
  const res = await fetch(endpoint, { method: "POST" });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error ?? `POST ${endpoint} failed: ${res.status}`);
  }

  return res.json();
}

export function streamUrl(batchId: string): string {
  return `${API_URL}/batches/${batchId}/stream`;
}
