import { isIP } from 'node:net';
import proxyaddr from 'proxy-addr';

/** Decides whether the hop at `addr` (the `i`-th from the backend) is a proxy of ours. */
export type TrustProxy = (addr: string, i: number) => boolean;

/** Loopback, private and link-local ranges: where a reverse proxy of ours usually sits. */
const PRIVATE_RANGES = ['loopback', 'linklocal', 'uniquelocal'];

/**
 * Reads `TRUST_PROXY`, with Express's `trust proxy` vocabulary:
 * - unset or empty: the peers on a private address (loopback, private, link-local);
 * - `false` / `true`: no proxy / every hop;
 * - a number: that many proxies in front of the backend;
 * - a comma-separated list of addresses, CIDR ranges or the names `loopback`,
 *   `linklocal`, `uniquelocal`.
 * Only a trusted hop may speak for the client through `X-Forwarded-For` and
 * `X-Forwarded-Proto`.
 */
export function parseTrustProxy(value: string | undefined): TrustProxy {
  const raw = value?.trim() ?? '';
  if (raw === '') return proxyaddr.compile(PRIVATE_RANGES);
  if (raw === 'false') return () => false;
  if (raw === 'true') return () => true;
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    return (_addr, i) => i < hops;
  }
  return proxyaddr.compile(raw.split(',').map((part) => part.trim()));
}

let trust: TrustProxy | null = null;

/** The deployment's rule, read once from the environment. */
export function trustProxy(): TrustProxy {
  trust ??= parseTrustProxy(process.env.TRUST_PROXY);
  return trust;
}

/**
 * The address a connection comes from: the peer, or the client named by
 * `X-Forwarded-For` as far as the chain of trusted proxies vouches for it.
 * The same rule as Express's `req.ip`, for the sockets.
 */
export function clientIp(
  peer: string,
  forwardedFor: string | string[] | undefined,
  rule: TrustProxy = trustProxy(),
): string {
  // Entries that are not addresses are dropped: they could only name a made-up client.
  const header = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : (forwardedFor ?? ''))
    .split(',')
    .map((part) => part.trim())
    .filter((part) => isIP(part.startsWith('::ffff:') ? part.slice(7) : part) !== 0)
    .join(', ');
  const req = {
    connection: { remoteAddress: peer },
    socket: { remoteAddress: peer },
    headers: header ? { 'x-forwarded-for': header } : {},
  };
  try {
    return proxyaddr(req as never, rule) || peer;
  } catch {
    // A malformed header: the peer is all we know.
    return peer;
  }
}
