import { ACTION_DEMOS } from "./actions";
import { BLOCK_DEMOS } from "./blocks";
import { DATA_DEMOS } from "./data";
import { DISCLOSURE_DEMOS } from "./disclosure";
import { FEEDBACK_TEXT_DEMOS } from "./feedback-text";
import { INPUT_DEMOS } from "./inputs";
import type { ArcDemo } from "./gallery-context";

/** One live demo per Arc item, keyed by its registry name (see arc-catalog.ts). */
export const ARC_DEMOS: Record<string, ArcDemo> = {
  ...ACTION_DEMOS,
  ...INPUT_DEMOS,
  ...DISCLOSURE_DEMOS,
  ...FEEDBACK_TEXT_DEMOS,
  ...DATA_DEMOS,
  ...BLOCK_DEMOS,
};
