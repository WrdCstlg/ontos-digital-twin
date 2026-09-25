import { MAPPING_SYNC_KIND, mappingSyncHandler } from "../mappingSync";
import type { JobHandler } from "./worker";

/** Every job kind a worker can run. A kind with no handler here fails permanently. */
export const jobHandlers: Record<string, JobHandler> = {
  [MAPPING_SYNC_KIND]: mappingSyncHandler,
};
