"use client";

import { getBatchDetail, streamUrl } from "@/lib/api";
import type { BatchDetail, BatchEvent, UrlCheck } from "@url-checker/contracts";
import { useEffect, useRef, useState } from "react";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "closed";

function replaceCheck(checks: UrlCheck[], updated: UrlCheck): UrlCheck[] {
  return checks.map((check) => (check.id === updated.id ? updated : check));
}

export function useBatchStream(batchId: string, initial: BatchDetail) {
  const [detail, setDetail] = useState<BatchDetail>(initial);

  const isTerminal =
    detail.batch.status === "completed" || detail.batch.status === "cancelled";

  const [liveConnection, setConnection] =
    useState<ConnectionState>("connecting");

  const connection: ConnectionState = isTerminal ? "closed" : liveConnection;

  const isFirstOpen = useRef(true);

  useEffect(() => {
    if (isTerminal) {
      return;
    }

    const source = new EventSource(streamUrl(batchId));

    source.onopen = () => {
      setConnection("live");

      if (isFirstOpen.current) {
        isFirstOpen.current = false;
        return;
      }

      // Reconnect: discard deltas we may have missed and take a fresh snapshot.
      getBatchDetail(batchId).then((fresh) => {
        if (fresh) {
          setDetail(fresh);
        }
      });
    };

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as BatchEvent;

      setDetail((current) => {
        if (event.type === "batch-updated") {
          return {
            ...current,
            batch: {
              ...current.batch,
              status: event.status,
              progress: event.progress,
            },
          };
        }

        return {
          ...current,
          batch: { ...current.batch, progress: event.progress },
          checks: replaceCheck(current.checks, event.check),
        };
      });
    };

    source.onerror = () => setConnection("reconnecting");

    return () => source.close();
  }, [batchId, isTerminal]);

  return { detail, connection, setDetail };
}
