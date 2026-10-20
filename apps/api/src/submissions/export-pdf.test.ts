import { describe, expect, it } from 'vitest';
import { listHtml } from './export-pdf';

describe('listHtml', () => {
  const html = listHtml({
    title: 'Inspection <équipement>',
    subtitle: 'Démo · 2 fiche(s)',
    headers: ['Créée le', 'Remarque'],
    rows: [
      ['20/10/2026 09:00', '<img src="https://evil.example/x.png" onerror="alert(1)">'],
      ['20/10/2026 10:00', `Fuite d'huile & "joint" usé`],
    ],
  });

  it('échappe toute valeur : une saisie ne devient jamais du balisage', () => {
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=&quot;https://evil.example/x.png&quot;');
    expect(html).toContain('Fuite d&#39;huile &amp; &quot;joint&quot; usé');
    expect(html).toContain('<h1>Inspection &lt;équipement&gt;</h1>');
  });

  it('interdit scripts et ressources externes, répète l’en-tête de colonnes', () => {
    expect(html).toContain(`default-src 'none'`);
    expect(html).not.toMatch(/<script|<link|https?:\/\/(?!evil)/);
    expect(html).toContain('<thead><tr><th>Créée le</th><th>Remarque</th></tr></thead>');
    expect(html.match(/<tr>/g)).toHaveLength(3);
  });
});
