/** Liste de fiches mise en page pour l'export PDF (Gotenberg/Chromium, A4 paysage). */
export interface PdfTable {
  title: string;
  subtitle: string;
  headers: string[];
  rows: string[][];
}

const escapeHtml = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * Page HTML autonome : tout le texte est échappé (une saisie ne devient jamais du balisage) et la
 * politique de sécurité interdit script et ressource externe, par précaution.
 */
export function listHtml(table: PdfTable): string {
  const cell = (tag: 'th' | 'td') => (text: string) => `<${tag}>${escapeHtml(text)}</${tag}>`;
  const head = table.headers.map(cell('th')).join('');
  const body = table.rows.map((row) => `<tr>${row.map(cell('td')).join('')}</tr>`).join('');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(table.title)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2933; margin: 0; }
  h1 { font-size: 15pt; margin: 0 0 2pt; color: #14284b; }
  p { font-size: 8.5pt; margin: 0 0 10pt; color: #52606d; }
  table { width: 100%; border-collapse: collapse; font-size: 7.5pt; }
  thead { display: table-header-group; }
  th { background: #14284b; color: #fff; text-align: left; font-weight: 600; }
  th, td { padding: 3pt 4pt; border: 0.5pt solid #cbd2d9; vertical-align: top; overflow-wrap: break-word; }
  tr { break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #f5f7fa; }
</style>
</head>
<body>
<h1>${escapeHtml(table.title)}</h1>
<p>${escapeHtml(table.subtitle)}</p>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body>
</html>`;
}
