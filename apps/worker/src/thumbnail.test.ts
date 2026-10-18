import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { makeThumbnail, processThumbnail } from './thumbnail.js';

const image = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#1F6F5C' } })
    .png()
    .toBuffer();

describe('makeThumbnail', () => {
  it('réduit en conservant les proportions, au format JPEG', async () => {
    const meta = await sharp(await makeThumbnail(await image(1600, 800))).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 320, height: 160 });
  });

  it('n agrandit pas une petite image', async () => {
    const meta = await sharp(await makeThumbnail(await image(100, 50))).metadata();
    expect(meta).toMatchObject({ width: 100, height: 50 });
  });
});

describe('processThumbnail', () => {
  const job = { instanceId: 'i1', fileId: 'f1', key: 'i1/f1', thumbnailKey: 'i1/thumbs/f1.jpg' };

  it('écrit la miniature puis l enregistre dans le contexte de l instance', async () => {
    const source = await image(640, 640);
    const sent: { input: Record<string, unknown> }[] = [];
    const s3 = {
      send: vi.fn(async (command: { input: Record<string, unknown> }) => {
        sent.push(command);
        return { Body: { transformToByteArray: async () => new Uint8Array(source) } };
      }),
    };
    const queries: unknown[][] = [];
    const client = {
      query: vi.fn(async (...args: unknown[]) => queries.push(args)),
      release: vi.fn(),
    };
    await processThumbnail(job, {
      s3: s3 as never,
      bucket: 'b',
      db: { connect: async () => client } as never,
    });
    expect(sent.map((c) => c.input['Key'])).toEqual(['i1/f1', 'i1/thumbs/f1.jpg']);
    expect(queries.map((q) => q[0])).toEqual([
      'BEGIN',
      "SELECT set_config('app.instance_id', $1, true)",
      'UPDATE files SET thumbnail_key = $1, updated_at = now() WHERE id = $2',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalled();
  });

  it('annule la transaction en cas d échec', async () => {
    const source = await image(10, 10);
    const s3 = {
      send: async () => ({ Body: { transformToByteArray: async () => new Uint8Array(source) } }),
    };
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('UPDATE')) throw new Error('db');
      }),
      release: vi.fn(),
    };
    await expect(
      processThumbnail(job, {
        s3: s3 as never,
        bucket: 'b',
        db: { connect: async () => client } as never,
      }),
    ).rejects.toThrow('db');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
