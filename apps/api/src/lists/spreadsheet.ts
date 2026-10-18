import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { readSheet } from 'read-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';

export type SpreadsheetFormat = 'csv' | 'xlsx';

export interface Table {
  headers: string[];
  rows: Record<string, string>[];
}

const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // archive ZIP

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function toTable(matrix: unknown[][]): Table {
  const [header = [], ...body] = matrix;
  const headers = header.map(cellToString);
  const rows = body
    .map((cells) =>
      Object.fromEntries(headers.map((name, index) => [name, cellToString(cells[index])])),
    )
    .filter((row) => Object.values(row).some((value) => value !== ''));
  return { headers, rows };
}

/** Lit un fichier CSV (`;` ou `,`, UTF-8 avec ou sans BOM) ou XLSX (première feuille). */
export async function readSpreadsheet(buffer: Buffer): Promise<Table> {
  if (buffer.subarray(0, 4).equals(XLSX_MAGIC)) {
    return toTable(await readSheet(buffer));
  }
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const matrix = parse(text, {
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as string[][];
  return toTable(matrix);
}

/** Écrit un tableau : CSV `;` avec BOM (ouverture directe dans Excel en français) ou XLSX. */
export async function writeSpreadsheet(format: SpreadsheetFormat, table: Table): Promise<Buffer> {
  const matrix = [
    table.headers,
    ...table.rows.map((row) => table.headers.map((h) => row[h] ?? '')),
  ];
  if (format === 'xlsx') return writeXlsxFile(matrix).toBuffer();
  return Buffer.from(`\uFEFF${stringify(matrix, { delimiter: ';' })}`, 'utf8');
}
