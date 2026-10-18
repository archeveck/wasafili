import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { buildDocx, paragraph, solidPng, table } from './build-docx';
import { inspectTemplate, renderTemplate, renderText, TemplateSyntaxError } from './docx';

const documentXml = (docx: Buffer) => new PizZip(docx).file('word/document.xml')!.asText();

const template = buildDocx(
  [
    paragraph('Fiche {{_formulaire}} : {{equipement}}'),
    table([
      ['Point', 'Conforme'],
      ['{{#points}}{{libelle}}', '{{conforme}} ({{equipement}}){{/points}}'],
    ]),
    paragraph('{{@signature}}'),
    paragraph('{{@photos:6}}'),
  ].join(''),
);

describe('inspectTemplate', () => {
  it('liste les balises, boucles et images avec leur boucle englobante', () => {
    expect(inspectTemplate(template)).toEqual([
      { name: '_formulaire', kind: 'value' },
      { name: 'equipement', kind: 'value' },
      { name: 'points', kind: 'loop' },
      { name: 'libelle', kind: 'value', parent: 'points' },
      { name: 'conforme', kind: 'value', parent: 'points' },
      { name: 'equipement', kind: 'value', parent: 'points' },
      { name: 'signature', kind: 'image' },
      { name: 'photos', kind: 'image' },
    ]);
  });

  it('explique les erreurs de syntaxe en français', () => {
    const broken = buildDocx(paragraph('{{#points}} sans fin {{equipement'));
    expect(() => inspectTemplate(broken)).toThrow(TemplateSyntaxError);
    try {
      inspectTemplate(broken);
    } catch (error) {
      expect((error as TemplateSyntaxError).problems.join(' ')).toMatch(/n'est pas fermée/);
    }
  });

  it('refuse un fichier qui n’est pas un DOCX', () => {
    expect(() => inspectTemplate(Buffer.from('pas un zip'))).toThrow(/pas un document DOCX/);
  });
});

describe('renderTemplate', () => {
  const png = solidPng(40, 20, [200, 0, 0]);

  it('fusionne valeurs, boucles (avec la portée parente) et images', () => {
    const out = renderTemplate(
      template,
      {
        _formulaire: 'Inspection',
        equipement: 'Ascenseur <A&B>',
        points: [
          { libelle: 'Câbles', conforme: 'Oui' },
          { libelle: 'Freins', conforme: 'Non' },
        ],
        signature: { kind: 'image', fileIds: ['sig'], width: 5 },
        photos: { kind: 'image', fileIds: ['p1', 'absente'], width: 12 },
      },
      new Map([
        ['sig', { data: png, mimeType: 'image/png' }],
        ['p1', { data: png, mimeType: 'image/png' }],
      ]),
    );
    const xml = documentXml(out);
    expect(xml).toContain('Ascenseur &lt;A&amp;B&gt;');
    expect(xml).toContain('Câbles');
    expect(xml).toContain('Oui (Ascenseur');
    expect(xml).toContain('Freins');
    expect(xml.match(/<w:drawing>/g)).toHaveLength(2);
    // Largeur demandée par la balise (6 cm) ; image 2:1.
    expect(xml).toContain('cx="2160000" cy="1080000"');
    expect(xml).toContain('[image indisponible]');
    const zip = new PizZip(out);
    expect(zip.file('word/_rels/document.xml.rels')!.asText()).toContain('media/tesserax_1.png');
    expect(zip.file('word/media/tesserax_1.png')).toBeTruthy();
    expect(zip.file('[Content_Types].xml')!.asText()).toContain('Extension="png"');
  });

  it('n’insère jamais de XML brut issu d’une saisie', () => {
    const out = renderTemplate(
      buildDocx(paragraph('{{@signature}}')),
      { signature: '</w:t></w:r><w:r><w:t>injecté' },
      new Map(),
    );
    const xml = documentXml(out);
    expect(xml).not.toContain('<w:t>injecté');
    expect(xml).toContain('&#60;/w:t&#62;');
  });

  it('laisse vides les balises sans valeur', () => {
    const xml = documentXml(renderTemplate(buildDocx(paragraph('[{{inconnu}}]')), {}, new Map()));
    expect(xml).toContain('[]');
  });
});

describe('renderText', () => {
  it('remplace les balises simples, ignore les valeurs non textuelles', () => {
    expect(
      renderText('Fiche {{ equipement }} : {{_etat}} {{photos}}', {
        equipement: 'A1',
        _etat: 'Validé',
        photos: { kind: 'image' },
      }),
    ).toBe('Fiche A1 : Validé ');
  });
});
