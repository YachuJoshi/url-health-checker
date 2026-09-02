import { MAX_URLS_PER_BATCH } from "@url-checker/contracts";
import { z } from "zod";

export const CreateBatchSchema = z.object({
  urls: z
    .array(z.string().min(1))
    .min(1, "At least one URL is required")
    .max(MAX_URLS_PER_BATCH),
});
