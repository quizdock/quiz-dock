/**
 * The public demo's time on page (`tools/demo-stats`): only while the tab is visible,
 * sent once, when it is first hidden (or left), as plain text — no preflight, no
 * cookie, no storage, no identifier: the seconds alone.
 */
export function trackTimeOnPage(endpoint: string): void {
  if (typeof navigator.sendBeacon !== 'function') return;
  let visibleMs = 0;
  let since = document.visibilityState === 'visible' ? performance.now() : null;
  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    const s = Math.round(visibleMs / 1000);
    if (s >= 1) {
      navigator.sendBeacon(endpoint, new Blob([JSON.stringify({ s })], { type: 'text/plain' }));
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      since ??= performance.now();
      return;
    }
    if (since !== null) visibleMs += performance.now() - since;
    since = null;
    send();
  });
  window.addEventListener('pagehide', () => {
    if (since !== null) visibleMs += performance.now() - since;
    since = null;
    send();
  });
}
