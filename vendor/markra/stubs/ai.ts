/**
 * Type-only stand-in for `@markra/ai`.
 *
 * The editor package imports five types from the AI package. mdpad does not
 * ship Markra's AI features, so only the shapes those imports need are copied
 * here — verbatim from `packages/ai/src/agent/inline.ts` at the vendored
 * commit. Nothing at runtime resolves through this module.
 */

export type AiDiffTarget = {
  from?: number;
  id?: string;
  kind:
    | "current_block"
    | "document"
    | "document_end"
    | "heading"
    | "section"
    | "selection"
    | "table";
  title?: string;
  to?: number;
};

export type AiDiffResult =
  | {
      from?: number;
      original: string;
      replacement: string;
      target?: AiDiffTarget;
      to?: number;
      type: "insert" | "replace";
    }
  | {
      message: string;
      type: "error";
    };

export type AiSelectionContext = {
  cursor?: number;
  fullDocument?: boolean;
  from: number;
  source?: "block" | "selection";
  text: string;
  to: number;
};

export type AiHeadingAnchor = {
  from: number;
  level: number;
  title: string;
  to: number;
};

export type AiDocumentAnchor = {
  description: string;
  from: number;
  id: string;
  kind:
    | "current_block"
    | "document"
    | "document_end"
    | "heading"
    | "section"
    | "table";
  text?: string;
  to: number;
  title?: string;
};
