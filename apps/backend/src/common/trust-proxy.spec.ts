import { clientIp, parseTrustProxy } from './trust-proxy';

describe('clientIp', () => {
  const byDefault = parseTrustProxy(undefined);

  it('takes the peer when it connects directly, whatever header it sends', () => {
    expect(clientIp('203.0.113.7', '198.51.100.1', byDefault)).toBe('203.0.113.7');
  });

  it('believes the header behind a private proxy, read from the right', () => {
    expect(clientIp('::ffff:172.18.0.3', '198.51.100.9, 203.0.113.7', byDefault)).toBe(
      '203.0.113.7',
    );
  });

  it('skips the proxies of the chain', () => {
    expect(clientIp('127.0.0.1', '203.0.113.7, 10.0.0.2', byDefault)).toBe('203.0.113.7');
  });

  it('keeps the peer when the header is missing or makes no sense', () => {
    expect(clientIp('10.0.0.2', undefined, byDefault)).toBe('10.0.0.2');
    expect(clientIp('10.0.0.2', 'garbage', byDefault)).toBe('10.0.0.2');
  });
});

describe('parseTrustProxy', () => {
  it('false: never believes the header, even from a private peer', () => {
    expect(clientIp('172.18.0.3', '203.0.113.7', parseTrustProxy('false'))).toBe('172.18.0.3');
  });

  it('a hop count: believes that many proxies, no more', () => {
    const one = parseTrustProxy('1');
    // A client forging a first entry cannot go past the one proxy trusted.
    expect(clientIp('198.51.100.20', '1.2.3.4, 203.0.113.7', one)).toBe('203.0.113.7');
  });

  it('a list: believes only the named proxies', () => {
    const rule = parseTrustProxy('198.51.100.20, 10.1.0.0/16');
    expect(clientIp('198.51.100.20', '203.0.113.7', rule)).toBe('203.0.113.7');
    expect(clientIp('10.1.4.4', '203.0.113.7', rule)).toBe('203.0.113.7');
    // Docker's userland proxy hides the client behind a private address: not trusted here.
    expect(clientIp('172.18.0.1', '203.0.113.7', rule)).toBe('172.18.0.1');
  });

  it('true: believes the whole chain', () => {
    expect(clientIp('198.51.100.20', '203.0.113.7, 10.0.0.2', parseTrustProxy('true'))).toBe(
      '203.0.113.7',
    );
  });
});
