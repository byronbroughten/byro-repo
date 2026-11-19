// The outcome facts a wrap-up computes from transcripts: where transcripts are (transcriptFacts/transcriptLocation.ts), what
// their replies cost (transcriptPricing.ts) and the facts themselves (transcriptOutcomes.ts). This file re-assembles them.
// The location and pricing pieces share members inside the folder that stay out of this file, so they are named here.

export {
  accountConfigFoldersOf,
  configFolderOf,
  type DateRange,
  hasTranscript,
  type LocalTranscript,
  localTranscriptsOf,
  type SessionEntries,
  timeOf,
  type Transcript,
  type TranscriptEntry,
} from "./transcriptFacts/transcriptLocation.ts";
export * from "./transcriptFacts/transcriptOutcomes.ts";
export {
  costUsdOf,
  type ModelPrice,
  modelPrices,
} from "./transcriptFacts/transcriptPricing.ts";
