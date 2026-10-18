import { describe, expect, it } from 'vitest';
import { currentContext, runWithContext } from './request-context';

describe('runWithContext', () => {
  it('expose le contexte aux appels synchrones et asynchrones', async () => {
    const seen = await runWithContext({ instanceId: 'i1' }, async () => {
      await Promise.resolve();
      return currentContext()?.instanceId;
    });
    expect(seen).toBe('i1');
  });

  it('exécute une promesse paresseuse (type PrismaPromise) dans le contexte', async () => {
    const lazy = {
      then<R>(resolve: (value: string | undefined) => R) {
        return Promise.resolve(resolve(currentContext()?.userId));
      },
    };
    expect(await runWithContext({ userId: 'u1' }, () => lazy)).toBe('u1');
  });

  it('ne laisse pas fuir le contexte hors de son exécution', async () => {
    await runWithContext({ instanceId: 'i1' }, () => undefined);
    expect(currentContext()).toBeUndefined();
  });
});
