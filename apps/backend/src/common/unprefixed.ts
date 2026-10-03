import { ICONS } from '../app-config/app-config.controller';

/**
 * Routes served at the root, where something asks for them there (the page, a
 * container's health check); every other route is the API, under `/api/v1`.
 * One list for the server and the OpenAPI document generated without it.
 */
export const UNPREFIXED_ROUTES = [
  'health',
  'health/ready',
  'config.js',
  'branding/override.css',
  'manifest.webmanifest',
  ...ICONS,
];
