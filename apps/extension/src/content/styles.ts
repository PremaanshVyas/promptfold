/**
 * PromptFold UI styles, one coherent type scale, scoped inside a Shadow root so
 * nothing leaks in or out. Design goals from real-use feedback: consistent font
 * sizes (no mixed sizes on one line), readable contrast (not washed-out grey),
 * and a clear, organized layout you read before copying/exporting.
 *
 * Type scale:  label 11 · meta 12.5 · body 14 · title 16 · mono 12.5
 * Palette:     neutral zinc greys + a single teal accent (vendor-neutral, so it
 *              does not look tied to any one chatbot).
 */
export const STYLES = `
:host {
  all: initial;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --ink: #1c1c1f; --muted: #56565c; --faint: #8a8a90;
  --line: #e6e6e9; --bg: #ffffff; --panel: #f6f6f7;
  --accent: #2f7f7a; --green: #2f7d32; --blue: #1a66c2; --rose: #c2554b;
}
* { box-sizing: border-box; }

.cb-fab {
  position: fixed; right: 20px; bottom: 96px; z-index: 2147483646;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 16px; border: none; border-radius: 999px; cursor: pointer;
  background: var(--accent); color: #fff; font-size: 14px; font-weight: 600;
  box-shadow: 0 4px 14px rgba(0,0,0,.22);
  transition: transform .12s ease, filter .12s ease;
}
.cb-fab:hover { transform: translateY(-1px); filter: brightness(1.05); }
.cb-fab:disabled { opacity: .65; cursor: progress; }

.cb-overlay {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(0,0,0,.32); display: flex; justify-content: flex-end;
}
.cb-drawer {
  width: min(580px, 100vw); height: 100%; background: var(--bg); color: var(--ink);
  display: flex; flex-direction: column; box-shadow: -8px 0 28px rgba(0,0,0,.22);
  animation: cb-slide .18s ease-out;
}
@keyframes cb-slide { from { transform: translateX(24px); opacity: .5 } to { transform: none; opacity: 1 } }

/* Header */
.cb-head {
  padding: 16px 22px; border-bottom: 1px solid var(--line);
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
}
.cb-title { font-size: 16px; font-weight: 700; line-height: 1.2; }
.cb-sub { font-size: 12.5px; color: var(--muted); margin-top: 3px; }
.cb-marker {
  display: inline-block; margin-top: 7px; font-size: 11px; color: var(--green);
  background: rgba(47,125,50,.10); border-radius: 6px; padding: 2px 7px;
}
.cb-close {
  border: none; background: none; font-size: 22px; line-height: 1; cursor: pointer;
  color: var(--faint); padding: 0 2px;
}
.cb-close:hover { color: var(--ink); }

/* Body */
.cb-body { padding: 18px 22px; overflow-y: auto; flex: 1; }

.cb-section { margin-bottom: 22px; }
.cb-section h3 {
  font-size: 11px; text-transform: uppercase; letter-spacing: .06em; font-weight: 700;
  color: var(--faint); margin: 0 0 9px; padding-bottom: 5px; border-bottom: 1px solid var(--line);
}
.cb-section.decided h3 { color: var(--green); }
.cb-section.open h3 { color: var(--blue); }
.cb-section.rejected h3 { color: var(--rose); }

/* Lists, every item is 14px; the "why" is muted but the SAME size. */
.cb-list { margin: 0; padding: 0; list-style: none; }
.cb-list li {
  font-size: 14px; line-height: 1.55; color: var(--ink);
  padding: 5px 0 5px 16px; position: relative;
}
.cb-list li::before {
  content: "•"; position: absolute; left: 2px; color: var(--faint);
}
.cb-why { color: var(--muted); }            /* same font-size as the line */
.cb-rej-idea { font-weight: 600; }

/* Verbatim */
.cb-vitem { margin: 8px 0; }
.cb-vlabel {
  font-size: 12.5px; color: var(--muted); margin-bottom: 3px;
}
.cb-vvalue {
  font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  padding: 2px 7px; color: var(--ink); word-break: break-word;
}
.cb-code {
  font: 12.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
  padding: 10px 12px; white-space: pre-wrap; overflow-x: auto; margin: 6px 0;
  color: var(--ink);
}

/* Files */
.cb-file { font-size: 14px; line-height: 1.5; }
.cb-file code {
  font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--panel); border: 1px solid var(--line);
  padding: 1px 6px; border-radius: 5px;
}

.cb-now { font-size: 14px; line-height: 1.55; color: var(--ink); }

.cb-empty { color: var(--faint); font-size: 13px; font-style: italic; }

/* Resume-framing preview */
.cb-frame {
  border: 1px dashed var(--line); border-radius: 8px; padding: 9px 11px;
  font-size: 13px; line-height: 1.5; color: var(--muted); background: var(--panel);
  margin: 4px 0 16px;
}
.cb-frame .cb-frame-label {
  display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .06em;
  color: var(--faint); margin-bottom: 4px;
}

.cb-warn {
  background: #fff4e5; border: 1px solid #ffcf99; border-radius: 8px;
  padding: 10px 12px; font-size: 13px; line-height: 1.5; color: #8a4b00; margin-bottom: 16px;
}

/* No-key panel */
.cb-needkey { padding: 30px 24px; }
.cb-needkey h2 { font-size: 17px; margin: 0 0 10px; }
.cb-needkey p { font-size: 14px; line-height: 1.6; color: var(--muted); }

/* Footer */
.cb-foot {
  border-top: 1px solid var(--line); padding: 12px 22px 14px;
  display: flex; flex-direction: column; gap: 10px;
}
.cb-toolbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.cb-toggle {
  display: inline-flex; align-items: center; gap: 7px; font-size: 13px;
  color: var(--muted); cursor: pointer; user-select: none;
}
.cb-toggle input { width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; }
.cb-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cb-btn {
  border: 1px solid var(--line); background: var(--bg); color: var(--ink);
  padding: 9px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600;
}
.cb-btn:hover { background: var(--panel); }
.cb-btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.cb-btn.primary:hover { filter: brightness(1.05); background: var(--accent); }
.cb-btn.ghost { padding: 9px 11px; font-weight: 500; color: var(--muted); }
.cb-toast { font-size: 12.5px; color: var(--green); opacity: 0; transition: opacity .2s; }
.cb-toast.show { opacity: 1; }

@media (prefers-color-scheme: dark) {
  :host {
    --ink: #ededee; --muted: #a6a6ac; --faint: #7d7d83;
    --line: #34343a; --bg: #1c1c1f; --panel: #27272b;
    --accent: #3aa19a; --green: #6bbf6e; --blue: #6ea8e6; --rose: #e08a82;
  }
  .cb-warn { background: #3a2f1c; border-color: #6b552e; color: #f0c889; }
}
`;
