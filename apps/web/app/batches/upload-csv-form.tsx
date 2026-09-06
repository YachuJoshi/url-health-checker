"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_URLS_PER_BATCH } from "@url-checker/contracts";
import { createBatch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Upload } from "lucide-react";

export function UploadCSVForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function parseUrls(raw: string): string[] {
    return raw
      .split(/[\n,]/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_URLS_PER_BATCH);
  }

  async function handleFile(file: File) {
    setText(await file.text());
  }

  async function handleSubmit() {
    const urls = parseUrls(text);

    if (urls.length === 0) {
      setError("Enter at least one URL");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { batchId } = await createBatch({ urls });
      router.refresh();
      router.push(`/batches/${batchId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"https://example.com\nhttps://github.com"}
        rows={5}
        className="font-mono text-sm resize-none"
      />
      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-1.5 h-8 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors">
          <Upload className="size-3.5" />
          <span>Upload CSV</span>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            onChange={(e) =>
              e.target.files?.[0] && handleFile(e.target.files[0])
            }
          />
        </label>
        <Button
          onClick={handleSubmit}
          disabled={submitting}
          size="sm"
          className="ml-auto"
        >
          {submitting ? "Submitting…" : "Check URLs"}
        </Button>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
