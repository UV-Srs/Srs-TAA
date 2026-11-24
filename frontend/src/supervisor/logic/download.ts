import supervisorCss from '../supervisor.css?inline';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

/**
 * Prototype svDownload(): a standalone HTML copy of the report (without the action bar and the
 * out-of-spec chips) with the page CSS inlined. The prototype handed the file to its host's
 * download API (falling back to print); here the browser saves it as `{code}-lot-report.html`.
 */
export function downloadReport(reportEl: HTMLElement, code: string) {
  const clone = reportEl.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.actionbar,.rowbtns').forEach((n) => n.remove());
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(code)} lot report</title>`
    + '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">'
    + `<style>${supervisorCss}.sv-root{background:#fff}.sv-root .pvwrap{max-width:none;padding:24px}</style></head>`
    + `<body style="margin:0"><div class="sv-root">${clone.outerHTML}</div></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${code}-lot-report.html`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
