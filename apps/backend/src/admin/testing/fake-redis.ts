/** A Redis just good enough for the administration's tests: strings, NX, INCR, GETDEL, DEL, SCAN, MULTI. */
export function fakeRedis() {
  const values = new Map<string, string>();
  const set = (key: string, value: string, ...args: unknown[]) => {
    if (args.includes('NX') && values.has(key)) return null;
    values.set(key, value);
    return 'OK';
  };
  const incr = (key: string) => {
    const next = Number(values.get(key) ?? 0) + 1;
    values.set(key, String(next));
    return next;
  };
  const multi = () => {
    const steps: (() => [null, unknown])[] = [];
    const chain = {
      set: (key: string, value: string, ...args: unknown[]) => {
        steps.push(() => [null, set(key, value, ...args)]);
        return chain;
      },
      incr: (key: string) => {
        steps.push(() => [null, incr(key)]);
        return chain;
      },
      exec: () => Promise.resolve(steps.map((s) => s())),
    };
    return chain;
  };
  return {
    values,
    get: (key: string) => Promise.resolve(values.get(key) ?? null),
    set: (key: string, value: string, ...args: unknown[]) =>
      Promise.resolve(set(key, value, ...args)),
    del: (...keys: string[]) => Promise.resolve(keys.filter((k) => values.delete(k)).length),
    /** Prefix patterns only (`setup-session:*`). */
    scanKeys: (pattern: string) =>
      Promise.resolve([...values.keys()].filter((k) => k.startsWith(pattern.replace(/\*$/, '')))),
    getdel: (key: string) => {
      const v = values.get(key) ?? null;
      values.delete(key);
      return Promise.resolve(v);
    },
    multi,
  };
}

/** Instance flags held in memory (`OverridesService.flag` / `setFlag`). */
export function memoryFlags() {
  const flags = new Map<string, string>();
  return {
    flags,
    flag: (key: string) => Promise.resolve(flags.get(key) ?? null),
    setFlag: (key: string, value: string | null) => {
      if (value === null) flags.delete(key);
      else flags.set(key, value);
      return Promise.resolve();
    },
    takeFlag: (key: string, value: string) =>
      Promise.resolve(flags.get(key) === value && flags.delete(key)),
  };
}
