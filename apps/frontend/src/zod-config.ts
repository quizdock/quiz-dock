import { z } from 'zod';

// Zod probes `new Function` on its first parse to pick a faster path; the page's
// Content-Security-Policy forbids eval, so the probe would only log a violation.
// Imported first by main.tsx, before any module gets to parse.
z.config({ jitless: true });
