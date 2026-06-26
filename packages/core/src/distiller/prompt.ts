/**
 * The distiller instruction set. This is the product's opinion in text form:
 * keep state not summary, Rejected-with-why as a discrete bucket, latest-state
 * wins, loud honesty over silent guessing.
 *
 * Both prompts demand strict JSON matching the BriefState shape so the output
 * parses deterministically. The eval (see /eval) is what tunes this text.
 */

/** The JSON contract we ask the model to emit, described for the model. */
export const BRIEF_JSON_SHAPE = `{
  "decided":  [{ "text": string, "replaces"?: string }],
  "open":     [{ "text": string }],
  "rejected": [{ "idea": string, "why": string }],
  "verbatim": [{ "kind": "code"|"name"|"path"|"number"|"api"|"constraint", "label": string, "value": string, "language"?: string }],
  "filesToAttach": [{ "name": string, "why": string, "source": "chat"|"referenced" }]
}`;

const SHARED_RULES = `Rules you follow without exception:
- GROUND EVERYTHING. Before you record an item, find the exact place in the text
  that supports it. If you cannot point to it, do not record it. Never invent a
  decision, an open thread, a value, or a reason.
- NO FABRICATED RATIONALE. For every "rejected" item, "why" must be the reason
  actually stated or unmistakably implied. If an idea was dropped but NO reason
  is given, write "reason not stated", a wrong invented reason is worse than
  admitting the gap. "rejected" is the most important field: it is why a fresh
  chatbot stops re-suggesting dead ideas.
- KEEP EXACT, byte-for-byte: final code, real names, file paths, numbers, API
  contracts, and the precise wording of any constraint. Put these in "verbatim".
  Never paraphrase, reformat, or round a verbatim value.
- CRUSH TO NOTHING: apologies, filler, dead ends, retries, tool mechanics, and
  "try this / no that failed" loops. Maximize recall first, then cut noise.
- LATEST STATE WINS. If a value changed over the chat (e.g. a timeout 30 then
  60), record only the final value (60). Never both, never the stale one. The
  chunk you are given is labelled with its position; later chunks supersede
  earlier ones.
- For every decision, capture what it REPLACED in "replaces" when known.
- "filesToAttach" lists things to bring for full context: big/binary files from
  the chat, and things the chat only REFERRED to but never showed. Each needs
  one line in "why". Do not list intermediate drafts, only the final file.
- Keep each "verbatim" value SHORT (a value, a path, a constraint, a small
  snippet). NEVER paste a whole file or a long essay into "verbatim", list it in
  "filesToAttach" instead. Long inline values overflow the response and break it.
- Before you finish: verify the JSON parses, every verbatim value is copied
  exactly, and no rejected reason was invented.
- Output ONLY valid, COMPLETE JSON matching the shape. No prose, no markdown
  fences. If you have many items, be terse so the JSON finishes within limits.`;

/** System prompt for distilling ONE chunk into a mini-brief. */
export function chunkSystemPrompt(): string {
  return `You distill a slice of a long AI conversation into a structured state
brief. You are given PART of a conversation (one chunk). Extract only what this
chunk establishes.

Emit JSON of exactly this shape:
${BRIEF_JSON_SHAPE}

${SHARED_RULES}`;
}

export function chunkUserPrompt(
  chunkText: string,
  index: number,
  total: number,
): string {
  return `Conversation chunk ${index + 1} of ${total} (a HIGHER number means later in the chat, so it supersedes earlier chunks). Distill it into the JSON brief.

--- CHUNK START ---
${chunkText}
--- CHUNK END ---

Now output ONLY the JSON brief for the chunk above. Ground every item in the
text, keep verbatim values exact and short, never invent a rejected reason.`;
}

/** System prompt for MERGING mini-briefs, where latest-state-wins is enforced. */
export function mergeSystemPrompt(): string {
  return `You merge several mini-briefs (each from a consecutive chunk of the
SAME conversation, in order) into ONE final brief.

Emit JSON of exactly this shape:
${BRIEF_JSON_SHAPE}

Merge rules:
- LATEST STATE WINS. The mini-briefs are in chronological order. When two
  disagree about the same thing (a number, a decision, a value), keep ONLY the
  later version and drop the stale one entirely. Never list both.
- SUPERSESSION ACROSS SECTIONS, track each thread's FINAL status:
  • a "decided" item later contradicted or abandoned → move it to "rejected" with
    the reason it was dropped;
  • an "open" item later answered → move it to "decided" and remove from "open";
  • a "rejected" idea later revived and adopted → move it to "decided".
  Decide membership by the LATEST mini-brief that mentions the thread.
- DE-DUPLICATE. The same decision, file, or value mentioned in several chunks
  appears once, in its final form.
- Preserve every distinct "rejected" item with its reason, these accumulate.
  Keep "reason not stated" as-is; never upgrade it to an invented reason.
- Keep "verbatim" exact and final. Never re-paraphrase or average two values; if
  two genuinely conflict and neither is clearly later, keep the later-chunk one.
- ADD NOTHING new during merge. You may only delete, move, dedupe, and pick the
  latest. Before finishing, verify no thread appears in two sections and no value
  appears in both a stale and a final form.

${SHARED_RULES}`;
}

export function mergeUserPrompt(miniBriefsJson: string[]): string {
  const joined = miniBriefsJson
    .map((b, i) => `--- MINI-BRIEF ${i + 1} ---\n${b}`)
    .join("\n\n");
  return `Merge these ${miniBriefsJson.length} mini-briefs (chronological, higher number = later = wins on conflict) into one final brief.

${joined}

Now output ONLY the merged JSON brief. Apply latest-state-wins and supersession,
dedupe, add nothing new, and keep every distinct rejected item with its reason.`;
}
