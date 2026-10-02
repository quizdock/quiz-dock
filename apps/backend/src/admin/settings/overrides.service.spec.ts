import { OverridesService, SETTINGS_CHANNEL } from './overrides.service';
import { OverrideStore } from './settings.service';

/** A table of overrides whose reads can be held back, and a Redis that records what is published. */
function setup() {
  let rows: { key: string; value: string }[] = [];
  const held: Array<(r: typeof rows) => void> = [];
  let hold = false;
  const prisma = {
    instanceSetting: {
      findMany: () =>
        hold
          ? new Promise<typeof rows>((resolve) => held.push(resolve))
          : Promise.resolve([...rows]),
      upsert: ({ create }: { create: { key: string; value: string } }) => {
        rows = [...rows.filter((r) => r.key !== create.key), create];
        return Promise.resolve();
      },
      deleteMany: ({ where }: { where: { key: string; value?: string } }) => {
        const before = rows.length;
        rows = rows.filter(
          (r) => !(r.key === where.key && (!where.value || r.value === where.value)),
        );
        return Promise.resolve({ count: before - rows.length });
      },
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const published: [string, string][] = [];
  const redis = {
    publish: (channel: string, message: string) => {
      published.push([channel, message]);
      return Promise.resolve(1);
    },
  };
  const store = new OverrideStore();
  const service = new OverridesService(prisma as never, redis as never, store);
  return {
    service,
    store,
    published,
    setRows: (r: typeof rows) => (rows = r),
    holdReads: (on: boolean) => (hold = on),
    /** Ends the n-th read held back (in the order they began). */
    release: (n: number, r: typeof rows) => held[n](r),
  };
}

describe('OverridesService (§3.1)', () => {
  it('applies changes together, reads them back, and tells every replica', async () => {
    const { service, store, published } = setup();
    await service.apply([{ key: 'APP_NAME', value: 'Quiz' }], { name: 'ada' });
    expect(store.get('APP_NAME')).toBe('Quiz');
    expect(published).toEqual([[SETTINGS_CHANNEL, 'APP_NAME']]);
  });

  it('a read begun before a change never undoes it, whatever order they end in', async () => {
    const { service, store, holdReads, release } = setup();
    holdReads(true);
    const older = service.reload(); // began before the change…
    const newer = service.reload(); // …this one after it
    // The newer read ends first with the change; the older one ends last, stale.
    release(1, [{ key: 'APP_NAME', value: 'Newer' }]);
    release(0, [{ key: 'APP_NAME', value: 'Older' }]);
    await Promise.all([older, newer]);
    expect(store.get('APP_NAME')).toBe('Newer');
  });

  it('keeps the settings only: the instance flags live in the same table', async () => {
    const { service, store, setRows } = setup();
    setRows([
      { key: 'APP_NAME', value: 'Quiz' },
      { key: 'setup.completed', value: 'yes' },
    ]);
    await service.reload();
    expect(store.entries().map(([k]) => k)).toEqual(['APP_NAME']);
  });

  it('a flag taken by one caller is not taken again', async () => {
    const { service, setRows } = setup();
    setRows([{ key: 'setup.token', value: 'h' }]);
    expect(await service.takeFlag('token', 'h')).toBe(true);
    expect(await service.takeFlag('token', 'h')).toBe(false);
  });
});
