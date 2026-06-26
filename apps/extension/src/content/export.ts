/**
 * Export helpers, download the brief as Markdown / plain text, or open a
 * print-ready view (the browser's "Save as PDF" turns it into a PDF). No
 * external libraries: MV3 forbids remote code, so everything is built inline.
 */

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "handoff-brief"
  );
}

/** Trigger a file download from a string. */
export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportMarkdown(title: string, markdown: string): void {
  downloadText(`${slugify(title)}.md`, markdown, "text/markdown");
}

export function exportText(title: string, markdown: string): void {
  downloadText(`${slugify(title)}.txt`, markdown, "text/plain");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Minimal, safe Markdown → HTML for the print view (headings, lists, code, bold). */
function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  let inCode = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    if (raw.trim().startsWith("```")) {
      if (inCode) {
        out.push("</pre>");
        inCode = false;
      } else {
        closeList();
        out.push("<pre>");
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(raw));
      continue;
    }

    const inline = (s: string) =>
      escapeHtml(s)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/_([^_]+)_/g, "<em>$1</em>");

    const h = raw.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1]!.length;
      out.push(`<h${level}>${inline(h[2] ?? "")}</h${level}>`);
      continue;
    }
    const li = raw.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(li[1] ?? "")}</li>`);
      continue;
    }
    if (raw.trim() === "") {
      closeList();
      continue;
    }
    closeList();
    out.push(`<p>${inline(raw)}</p>`);
  }
  closeList();
  if (inCode) out.push("</pre>");
  return out.join("\n");
}

const PRINT_CSS = `
  body { font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #20201e; max-width: 760px; margin: 40px auto; padding: 0 24px; }
  h1 { font-size: 24px; } h2 { font-size: 16px; border-bottom: 1px solid #e8e4dc; padding-bottom: 4px; margin-top: 28px; }
  h3 { font-size: 14px; } ul { padding-left: 20px; } li { margin: 4px 0; }
  code { font: 13px ui-monospace, Menlo, monospace; background: #f4f2ee; padding: 1px 5px; border-radius: 4px; }
  pre { font: 13px ui-monospace, Menlo, monospace; background: #f4f2ee; border: 1px solid #e8e4dc;
    border-radius: 8px; padding: 12px; white-space: pre-wrap; }
  blockquote { color: #8a4b00; } strong { font-weight: 700; }
`;

/** Open a print-ready window (user picks "Save as PDF" in the print dialog). */
export function openPrintView(title: string, markdown: string): void {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head>
<body>${markdownToHtml(markdown)}
<script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
</body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
