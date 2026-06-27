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
  "now":      string,
  "decided":  [{ "text": string, "replaces"?: string }],
  "open":     [{ "text": string }],
  "rejected": [{ "idea": string, "why": string }],
  "verbatim": [{ "kind": "code"|"table"|"name"|"path"|"number"|"api"|"constraint", "label": string, "value": string, "language"?: string }],
  "filesToAttach": [{ "name": string, "why": string, "source": "chat"|"referenced" }]
}`;

const SHARED_RULES = `Rules you follow without exception:
- YOU ARE A SUMMARIZER, NOT AN ADVISOR. Describe only where the conversation
  stands. NEVER advise, recommend, suggest, prescribe a next step, or add your
  own opinion. Report what the conversation established, not what should happen.
  (Exception: if the conversation ITSELF contains advice the assistant gave and
  the user accepted, that is a decision or a verbatim value, record it as such,
  attributed to the chat, not as your own.)
- WORKS FOR ANY CHAT TYPE. This may be coding, writing, research, debugging,
  tutoring, planning, brainstorming, data analysis, translation, a plain Q&A, a
  decision, role-play, or anything else. Some sections will be empty for some
  chats (a pure Q&A has no "rejected"; a tutoring chat has few "decided"). That
  is fine. Use [] for an empty section; force nothing. The "now" line and
  "verbatim" facts carry chats that have no decisions.
- "now" is 1-3 plain, present-tense sentences describing the STATE OF THE WORK
  itself (what is being built, decided, or solved, and where it stands), in the
  project's own terms. Describe the PROJECT STATE, not the conversation: write
  "Building X; the comparison is done and the open question is Y", NOT "The
  assistant evaluated X" or "The user asked about Y". A continuation model cares
  what the project is, not what messages were exchanged. Factual, no advice, no
  "you should". RECENCY BEATS PROMINENCE: anchor "now" to the FINAL exchange (the
  last user message and its answer), even if an earlier code artifact, file, or
  build step looks more important. A salient mid-chat deliverable is NOT "now"
  unless the last turn is still about it. If the last turns shifted topic (e.g.
  to reviewing/testing/iterating), "now" reflects THAT, not the old frontier.
  ACCOUNT FOR EVERY DELIVERABLE: if the chat produced files, "now" must reflect
  ALL of them (every file, by name or exact count and types), never a subset, and
  never abstract "six files (docx, pdf, xlsx, md, csv, json)" into "two
  artifacts". For a multi-file build, the file COUNT is part of the state, a
  reader who sees an undercount thinks the missing files do not exist yet.
- GROUND EVERYTHING. Before you record an item, find the exact place in the text
  that supports it. If you cannot point to it, do not record it. Never invent a
  decision, an open thread, a value, or a reason.
- IGNORE META-COMMENTARY ABOUT THE BRIEF ITSELF. The conversation may contain
  text discussing this summary/brief/handoff, how it should be built, or critique
  of it ("the image should appear once", "the dedup target", "verbatim is
  bloated", "capture every content type"). That is commentary ABOUT the tool, NOT
  conversational state to preserve. Never copy it into any section, and never
  quote a brief's own structure (section names, "verbatim", "rejected") as
  content. Summarize the underlying work, not remarks about the summary.
- NEVER INVENT METADATA. Do not state a file's size, byte count, character count,
  line count, or any number that is not literally written in the chat. If a size
  is not given, omit it, a fabricated "5,000 chars" is a lie with false
  precision. Describe files qualitatively ("the full script", "the spreadsheet")
  instead.
- DECIDED vs OPEN IS ABOUT CERTAINTY, PRESERVE IT. "decided" = settled, the
  conversation committed to it. "open" = a real unresolved question OR an
  acknowledged-but-unsettled caveat. Keep an open caveat OPEN, never fold it into
  "decided" to look tidy. Signals it is still open: "some sources say", "might
  be", "need to verify/check", "unclear", or a stated ALTERNATIVE value that was
  noticed but not chosen (e.g. "labels list 510/390 instead of 500/370"). The
  chosen value is decided; the residual doubt about whether it is exact stays
  open. NEVER paraphrase a specific alternative value (510/390) into a general
  disclaimer ("treat as approximate"), keep the exact competing figures. An open
  item with a concrete value attached must survive verbatim, not be compressed.
- CAPTURE INTENT WHEN STATED. If the conversation says WHY the user is doing this
  (the purpose, the audience, that it is personal vs a side project / test),
  record it in one short clause in "now". Only when explicitly stated, never
  invent a motive.
- NO FABRICATED RATIONALE. For every "rejected" item, "why" must be the reason
  actually stated or unmistakably implied. If an idea was dropped but NO reason
  is given, write "reason not stated", a wrong invented reason is worse than
  admitting the gap. "rejected" is the most important field: it is why a fresh
  chatbot stops re-suggesting dead ideas.
- KEEP EXACT, byte-for-byte: final code, real names, file paths, numbers, API
  contracts, and the precise wording of any constraint. Put these in "verbatim".
  Never paraphrase, reformat, or round a verbatim value.
- ONE VALUE PER VERBATIM ITEM, CORRECTLY TYPED. Never merge two distinct values
  onto one line (two spreadsheet formulas =B2/B3 and =C2/C3 are TWO items, not
  "=B2/B3, =C2/C3"). Type by what it is: a cell/spreadsheet formula is "code" or
  "constraint", NEVER "api" (kind "api" is only for URLs and REST endpoints like
  GET /v1/users).
- VERBATIM IS LOAD-BEARING STATE, NOT BUILD MINUTIAE. Capture the values a next
  session must honor (a final decision, a key number, a constraint, an API
  contract, the final inline deliverable). Do NOT pin incidental implementation
  details lifted from a script or file: colour hex codes (#1A1A1A), margins
  (0.9*inch), number/format strings (0.0"x"), layout/row-placement notes,
  internal variable names. If the file itself is attached, its internal
  constants do not need re-pinning. When unsure whether a value is state or
  scaffolding, leave it out.
- TABLES AND STRUCTURED CONTENT ARE LOAD-BEARING. If the conversation contains a
  TABLE (a comparison, a spec sheet, a dataset, a pricing/options grid), keep it
  WHOLE in "verbatim" with kind "table", reproduced as a markdown table exactly,
  every row and column. NEVER summarize a table into prose or drop rows. The same
  goes for boxed/callout content, step lists, and any structured data the chat
  produced: capture it exactly, do not flatten it. Tables are usually the answer,
  not decoration.
- IMAGES ARE HANDLED FOR YOU. Do NOT add any "verbatim" item for an image, a
  shown photo, a chart, a screenshot, or an "[image shown: …]" note, image
  presence is captured automatically elsewhere, and a second copy from you
  duplicates it. You may mention an image in "now" ONLY if a shown image is the
  current focus of the last turn. Never paste an image URL anywhere.
- CRUSH TO NOTHING: apologies, filler, dead ends, retries, tool mechanics, and
  "try this / no that failed" loops. Maximize recall first, then cut noise.
- LATEST STATE WINS. If a value changed over the chat (e.g. a timeout 30 then
  60), record only the final value (60). Never both, never the stale one. The
  chunk you are given is labelled with its position; later chunks supersede
  earlier ones.
- For every decision, capture what it REPLACED in "replaces" when known.
- INCLUDE THE REASON in a "decided" item when the conversation states one ("use
  Postgres because the data is relational"). The reason stops a future model from
  "fixing" a settled choice. Only when actually stated, never invent one.
- FINAL INLINE DELIVERABLE. If the user asked the assistant to write a specific
  piece of text (an email, a letter, a message, a cover letter, a short post, a
  bio) and it lives ONLY inline in the chat (not saved as a file), put the FINAL
  COMPLETE version in "verbatim" (kind "constraint", label like "final email"),
  not just the edits to it. That text IS the deliverable; keep it whole even if
  it runs a paragraph or two. (A genuinely long document, a multi-page essay or a
  whole code file, still goes in "filesToAttach" instead.)
- "filesToAttach" lists things to bring for full context: big/binary files from
  the chat, and things the chat only REFERRED to but never showed. Each needs
  one line in "why". Do not list intermediate drafts, only the final file.
- NEVER store a model SANDBOX PATH as authoritative. Paths like
  "sandbox:/mnt/data/Report.docx" or "/mnt/data/..." or "/mnt/user-data/..." are
  session-local and will NOT exist in a new chat. Refer to a generated file by
  its NAME and type ("Report.docx, a Word document, generated this session"),
  never by its sandbox path, and never put such a path in "verbatim".
- Keep each "verbatim" value SHORT (a value, a path, a constraint, a small
  snippet), EXCEPT the single final inline deliverable above. NEVER paste a whole
  file or a long essay into "verbatim"; list those in "filesToAttach" instead.
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
- "now" comes from the LATEST mini-brief only (the current state is whatever the
  conversation ended on). Do not concatenate older "now" lines.
- LATEST STATE WINS. The mini-briefs are in chronological order. When two
  disagree about the same thing (a number, a decision, a value), keep ONLY the
  later version and drop the stale one entirely. Never list both.
- SUPERSESSION ACROSS SECTIONS, track each thread's FINAL status:
  • a "decided" item later contradicted or abandoned → move it to "rejected" with
    the reason it was dropped;
  • an "open" item later EXPLICITLY answered → move it to "decided" and remove
    from "open". Only when the conversation actually resolved it, an acknowledged
    but still-uncertain caveat (e.g. "some labels say 510/390") stays OPEN; do
    NOT promote lingering uncertainty into "decided" to tidy the brief, and do
    not drop its specific values;
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
