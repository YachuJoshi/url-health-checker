import { notFound } from "next/navigation";
import { getBatchDetail } from "@/lib/api";
import { BatchView } from "./batch-view";

// Never statically render — batch state is live.
export const dynamic = "force-dynamic";

export default async function BatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Fetched on the server so a cold open ships correct state in the HTML,
  // with no loading flash and no post-hydration round trip.
  const detail = await getBatchDetail(id);

  if (!detail) {
    notFound();
  }

  return <BatchView batchId={id} initial={detail} />;
}
