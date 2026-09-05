"use client";

import Link from "next/link";
import type { BatchDetail } from "@url-checker/contracts";
import { useBatchStream } from "@/hooks/useBatchStream";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Wifi, WifiOff } from "lucide-react";

const statusVariant: Record<
  string,
  | "default"
  | "secondary"
  | "success"
  | "destructive"
  | "outline"
  | "warning"
  | "info"
> = {
  completed: "success",
  succeeded: "success",
  running: "info",
  failed: "destructive",
  cancelled: "outline",
  pending: "secondary",
};

export function BatchView({
  batchId,
  initial,
}: {
  batchId: string;
  initial: BatchDetail;
}) {
  const { detail, connection } = useBatchStream(batchId, initial);
  const { batch, checks } = detail;
  const { progress } = batch;

  const done = progress.succeeded + progress.failed + progress.cancelled;
  const percent =
    progress.total > 0 ? Math.round((done / progress.total) * 100) : 0;
  const isLive = connection === "live";

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href="/batches"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
      >
        <ArrowLeft className="size-3.5" />
        All batches
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight font-mono">
          {batchId.slice(0, 8)}
        </h1>
        <Badge variant={statusVariant[batch.status] ?? "secondary"}>
          {batch.status}
        </Badge>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {isLive ? (
            <Wifi className="size-3.5 text-emerald-500" />
          ) : (
            <WifiOff className="size-3.5" />
          )}
          {connection}
        </span>
      </div>

      <div className="mb-6 flex flex-col gap-2">
        <Progress value={percent} className="h-1.5" />
        <p className="text-sm text-muted-foreground">
          {done} / {progress.total} checked — {progress.succeeded} succeeded,{" "}
          {progress.failed} failed
          {progress.cancelled > 0 && `, ${progress.cancelled} cancelled`}
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-64">URL</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>HTTP</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Title</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {checks.map((check) => (
            <TableRow key={check.id}>
              <TableCell className="font-mono text-xs max-w-64 truncate">
                {check.url}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant[check.status] ?? "secondary"}>
                  {check.status}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {check.httpStatus ?? "—"}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs tabular-nums">
                {check.responseMs != null ? `${check.responseMs}ms` : "—"}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs max-w-48 truncate">
                {check.pageTitle ?? check.error ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
