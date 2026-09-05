import Link from "next/link";
import { listBatches } from "@/lib/api";
import { UploadCSVForm } from "./upload-csv-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

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
  running: "info",
  failed: "destructive",
  cancelled: "outline",
  pending: "secondary",
};

export default async function BatchesPage() {
  const batches = await listBatches();

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          URL Health Checker
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Submit URLs to check their reachability and response times.
        </p>
      </div>

      <UploadCSVForm />

      <div className="mt-10">
        <h2 className="text-base font-semibold mb-4">Recent Batches</h2>
        {batches.length === 0 ? (
          <p className="text-muted-foreground text-sm">No batches yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => {
                const done =
                  batch.progress.succeeded +
                  batch.progress.failed +
                  batch.progress.cancelled;
                return (
                  <TableRow key={batch.id} className="relative cursor-pointer">
                    <TableCell>
                      <Link
                        href={`/batches/${batch.id}`}
                        className="font-mono text-xs after:absolute after:inset-0"
                      >
                        {batch.id.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={statusVariant[batch.status] ?? "secondary"}
                      >
                        {batch.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {done} / {batch.progress.total}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(batch.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
