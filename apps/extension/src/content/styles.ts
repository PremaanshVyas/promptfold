/**
 * All carrybot UI styles, scoped inside a Shadow root so they cannot leak into
 * Claude's page and Claude's CSS cannot leak into ours. `:host` resets inherited
 * values from the host page.
 */
export const STYLES = `
:host {
  all: initial;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
* { box-sizing: border-box; }

.cb-fab {
  position: fixed; right: 20px; bottom: 96px; z-index: 2147483646;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 14px; border: none; border-radius: 999px; cursor: pointer;
  background: #c96442; color: #fff; font-size: 14px; font-weight: 600;
  box-shadow: 0 4px 14px rgba(0,0,0,.25);
  transition: transform .12s ease, background .12s ease;
}
.cb-fab:hover { transform: translateY(-1px); background: #b5573a; }
.cb-fab:disabled { opacity: .6; cursor: progress; }

.cb-overlay {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(0,0,0,.32); display: flex; justify-content: flex-end;
}
.cb-drawer {
  width: min(560px, 100vw); height: 100%; background: #fff; color: #1f1f1f;
  display: flex; flex-direction: column; box-shadow: -8px 0 24px rgba(0,0,0,.2);
  animation: cb-slide .18s ease-out;
}
@keyframes cb-slide { from { transform: translateX(24px); opacity: .6 } to { transform: none; opacity: 1 } }

.cb-head {
  padding: 16px 20px; border-bottom: 1px solid #ececec;
  display: flex; align-items: center; justify-content: space-between;
}
.cb-title { font-size: 15px; font-weight: 700; }
.cb-sub { font-size: 12px; color: #6b6b6b; margin-top: 2px; }
.cb-marker {
  display: inline-block; margin-top: 6px; font-size: 11px; color: #2e7d32;
  background: #eaf6ea; border-radius: 6px; padding: 2px 6px;
}
.cb-close { border: none; background: none; font-size: 20px; cursor: pointer; color: #6b6b6b; }

.cb-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.cb-section { margin-bottom: 20px; }
.cb-section h3 {
  font-size: 12px; text-transform: uppercase; letter-spacing: .05em;
  color: #8a8a8a; margin: 0 0 8px;
}
.cb-section.decided h3 { color: #2e7d32; }
.cb-section.open h3 { color: #1565c0; }
.cb-section.rejected h3 { color: #b5573a; }
.cb-list { margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.5; }
.cb-list li { margin-bottom: 6px; }
.cb-why { color: #6b6b6b; }
.cb-code {
  background: #f6f6f4; border: 1px solid #ececec; border-radius: 8px;
  padding: 10px 12px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap; overflow-x: auto; margin: 6px 0;
}
.cb-file { font-size: 13px; }
.cb-file code { background: #f1efe9; padding: 1px 5px; border-radius: 4px; }
.cb-tag { font-size: 11px; color: #8a8a8a; }

.cb-warn {
  background: #fff4e5; border: 1px solid #ffcf99; border-radius: 8px;
  padding: 10px 12px; font-size: 13px; color: #8a4b00; margin-bottom: 16px;
}

.cb-empty { color: #8a8a8a; font-size: 13px; font-style: italic; }

.cb-foot {
  padding: 12px 20px; border-top: 1px solid #ececec;
  display: flex; gap: 10px; align-items: center;
}
.cb-btn {
  border: 1px solid #d8d8d8; background: #fff; color: #1f1f1f;
  padding: 9px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600;
}
.cb-btn.primary { background: #c96442; color: #fff; border-color: #c96442; }
.cb-btn:hover { filter: brightness(.97); }
.cb-toast { margin-left: auto; font-size: 12px; color: #2e7d32; opacity: 0; transition: opacity .2s; }
.cb-toast.show { opacity: 1; }

@media (prefers-color-scheme: dark) {
  .cb-drawer { background: #1f1e1d; color: #ededed; }
  .cb-head, .cb-foot { border-color: #38362f; }
  .cb-code { background: #2a2925; border-color: #38362f; color: #ededed; }
  .cb-btn { background: #2a2925; color: #ededed; border-color: #4a4840; }
  .cb-file code { background: #2a2925; }
}
`;
