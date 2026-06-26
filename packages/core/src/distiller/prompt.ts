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
- KEEP EXACT, byte-for-byte: final code, real names, file paths, numbers, API
  contracts, and the precise wording of any constraint. Put these in "verbatim".
- CRUSH TO NOTHING: apologies, dead ends, re-explanations, and "try this / no
  that failed" loops. They are noise.
- For every decision, also capture what it REPLACED or RULED OUT, so "rejected"
  stays accurate with a real reason in "why". This is the most important field —
  it is why a fresh chatbot stops re-suggesting dead ideas.
- LATEST STATE WINS. If a value changed over the chat (e.g. a timeout 30 then
  60), record only the final value (60). Never both, never the stale one.
- Do NOT invent. If something is unknown, leave it out rather than guess.
- "filesToAttach" lists things to bring for full context: big things from the
  chat better as a file, and things the chat only REFERRED to but never showed.
  Each needs one line in "why".
- Keep each "verbatim" value SHORT (a value, a path, a constraint, a small
  snippet). NEVER paste a whole file or a long essay into "verbatim" — list it in
  "filesToAttach" instead. Long inline values overflow the response and break it.
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
  return `Conversation chunk ${index + 1} of ${total}. Distill it into the JSON brief.

--- CHUNK START ---
${chunkText}
--- CHUNK END ---`;
}

/** System prompt for MERGING mini-briefs — where latest-state-wins is enforced. */
export function mergeSystemPrompt(): string {
  return `You merge several mini-briefs (each from a consecutive chunk of the
SAME conversation, in order) into ONE final brief.

Emit JSON of exactly this shape:
${BRIEF_JSON_SHAPE}

Merge rules:
- The mini-briefs are in chronological order. When two of them disagree about a
  value (a number, a decision, a piece of code), the LATER one wins. This is
  where "latest state wins" is enforced — drop the stale value entirely.
- A decision in a later chunk can move an earlier "open" item to "decided", or an
  earlier "decided"/"open" item to "rejected". Reflect the final state only.
- De-duplicate. The same decision or file mentioned in several chunks appears
  once, in its final form.
- Preserve every distinct "rejected" item with its reason — these accumulate.
- Keep "verbatim" exact. For code, keep only the final version of each file.

${SHARED_RULES}`;
}

export function mergeUserPrompt(miniBriefsJson: string[]): string {
  const joined = miniBriefsJson
    .map((b, i) => `--- MINI-BRIEF ${i + 1} ---\n${b}`)
    .join("\n\n");
  return `Merge these ${miniBriefsJson.length} mini-briefs (chronological) into one final brief.

${joined}`;
}
