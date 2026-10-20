import { describe, expect, it } from 'vitest';
import { type ImageFile, TemplateSyntaxError } from './docx';
import { inspectHtmlTemplate, renderHtmlTemplate } from './html';

const problems = (html: string) => {
  try {
    inspectHtmlTemplate(html);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(TemplateSyntaxError);
    return (error as TemplateSyntaxError).problems;
  }
};

const PNG = Buffer.from('png');
const images = new Map<string, ImageFile>([
  ['f1', { data: PNG, mimeType: 'image/png' }],
  ['f2', { data: PNG, mimeType: 'application/pdf' }],
]);

describe('inspectHtmlTemplate', () => {
  it('détecte valeurs, boucles et images, comme un modèle DOCX', () => {
    expect(
      inspectHtmlTemplate(
        '<h1>{{ equipement }}</h1>{{#pieces}}<td>{{reference}} {{_numero}}</td>{{/pieces}}{{@signature:5}}{{equipement}}',
      ),
    ).toEqual([
      { name: 'equipement', kind: 'value' },
      { name: 'pieces', kind: 'loop' },
      { name: 'reference', kind: 'value', parent: 'pieces' },
      { name: '_numero', kind: 'value', parent: 'pieces' },
      { name: 'signature', kind: 'image' },
    ]);
  });

  it('explique les erreurs de syntaxe', () => {
    expect(problems('{{#pieces}}<p>x</p>')).toEqual(["La boucle « {{#pieces}} » n'est pas fermée"]);
    expect(problems('{{/pieces}}')).toEqual(["La fin de boucle « {{/pieces}} » n'a pas de début"]);
    expect(problems('{{#a}}{{/b}}')).toEqual([
      'La fin de boucle « {{/b}} » ne correspond pas à « {{#a}} »',
    ]);
    expect(problems('<p>{{equipement</p>')).toEqual([
      "« {{equipement</p> » n'est pas fermée (il manque « }} »)",
    ]);
    expect(problems('{{Equipement}}')[0]).toContain('nom de balise invalide');
  });

  it('refuse scripts, cadres, événements et ressources externes', () => {
    expect(problems('<script>alert(1)</script>')).toEqual([
      'Les scripts (« <script> ») ne sont pas autorisés',
    ]);
    expect(problems('<iframe src="data:text/html,x"></iframe>')[0]).toBe(
      'La balise « <iframe> » n’est pas autorisée',
    );
    expect(problems('<img src="x" onerror="alert(1)">')).toContain(
      'Les attributs d’événement (« onclick=… ») ne sont pas autorisés',
    );
    expect(problems('<img src="https://exemple.ci/logo.png">')[0]).toContain(
      'Ressource externe interdite',
    );
    expect(problems('<img src="//exemple.ci/logo.png">')[0]).toContain('Ressource externe');
    expect(problems('<div style="background:url(http://x/y.png)">')[0]).toContain('url(');
    expect(problems('<style>@import "x.css";</style>')[0]).toContain('@import');
    expect(problems('<meta http-equiv="refresh" content="0;url=http://x">')[0]).toContain(
      'http-equiv',
    );
  });

  it('admet images data:, ancres et texte ordinaire', () => {
    expect(
      problems(
        '<img src="data:image/png;base64,AAAA"><a href="#haut">Haut</a>' +
          '<p>Option one = deux, voir src = notice</p><style>h1{color:#14284b}</style>',
      ),
    ).toEqual([]);
  });
});

describe('renderHtmlTemplate', () => {
  const data = {
    equipement: 'Groupe <b>électrogène</b> & "co"',
    pieces: [
      { _numero: 1, reference: 'CAB-12' },
      { _numero: 2, reference: '<script>x</script>' },
    ],
    signature: { kind: 'image', fileIds: ['f1'], width: 4 },
    photos: { kind: 'image', fileIds: ['f2', 'absente'], width: 8 },
    note: 'texte',
  };

  it('échappe chaque valeur et répète les lignes des tableaux', () => {
    const html = renderHtmlTemplate(
      '<h1>{{equipement}}</h1><ul>{{#pieces}}<li>{{_numero}}. {{reference}} ({{equipement}})</li>{{/pieces}}</ul>',
      data,
      images,
    );
    expect(html).toContain('<h1>Groupe &lt;b&gt;électrogène&lt;/b&gt; &amp; &quot;co&quot;</h1>');
    expect(html).toContain('<li>2. &lt;script&gt;x&lt;/script&gt; (Groupe &lt;b&gt;');
    expect(html).not.toContain('<script>');
  });

  it('intègre les images en data:, largeur de la balise ou par défaut', () => {
    const html = renderHtmlTemplate('{{@signature:5}}|{{@photos}}|{{@note}}', data, images);
    expect(html).toContain(
      `<img alt="" style="width:5cm;max-width:100%" src="data:image/png;base64,${PNG.toString('base64')}">`,
    );
    // Type non affichable et fichier absent : mention ; un texte reste du texte.
    expect(html).toContain('|<em>(image indisponible)</em> <em>(image indisponible)</em>|texte');
  });

  it('injecte la politique de sécurité, dans le head du modèle ou dans une page complète', () => {
    const page = renderHtmlTemplate(
      '<html><head><title>R</title></head><body>x</body></html>',
      {},
      images,
    );
    expect(page).toMatch(
      /<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:;/,
    );
    const fragment = renderHtmlTemplate('<p>{{note}}</p>', data, images);
    expect(fragment).toMatch(
      /^<!doctype html><html lang="fr"><head>.*Content-Security-Policy.*<body><p>texte<\/p><\/body><\/html>$/,
    );
  });
});
