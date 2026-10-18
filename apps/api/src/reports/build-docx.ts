import { crc32, deflateSync } from 'node:zlib';
import PizZip from 'pizzip';

/**
 * Construction de documents DOCX minimaux (modèle de démonstration, tests). Un vrai modèle est
 * rédigé dans Word ou LibreOffice ; ce constructeur ne sert qu'aux documents générés par le code.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const escape = (text: string) =>
  text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);

export interface RunStyle {
  bold?: boolean;
  size?: number;
  color?: string;
}

export function run(text: string, style: RunStyle = {}): string {
  const props = [
    style.bold ? '<w:b/>' : '',
    style.color ? `<w:color w:val="${style.color}"/>` : '',
    style.size ? `<w:sz w:val="${style.size * 2}"/>` : '',
  ].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;
}

export function paragraph(content: string | string[], options: { align?: 'center' } = {}): string {
  const runs = (Array.isArray(content) ? content : [run(content)]).join('');
  const props = options.align ? `<w:pPr><w:jc w:val="${options.align}"/></w:pPr>` : '';
  return `<w:p>${props}${runs}</w:p>`;
}

/** Tableau à bordures ; chaque cellule est un paragraphe (ou du XML de paragraphes). */
export function table(rows: string[][], options: { header?: boolean } = {}): string {
  const border =
    '<w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/>';
  const body = rows
    .map((cells, index) => {
      const shade = options.header && index === 0 ? '<w:shd w:val="clear" w:fill="E7EEF7"/>' : '';
      return `<w:tr>${cells
        .map(
          (cell) =>
            `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${shade}</w:tcPr>${cell.startsWith('<w:p') ? cell : paragraph(cell)}</w:tc>`,
        )
        .join('')}</w:tr>`;
    })
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders></w:tblPr>${body}</w:tbl>`;
}

/** Document DOCX dont le corps est le XML donné (paragraphes, tableaux). */
export function buildDocx(body: string): Buffer {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** PNG uni (image d'exemple des aperçus) ; aucune dépendance d'imagerie. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
