import { defineConfig } from 'orval';

// Génère le client REST (hooks TanStack Query) à partir de l'OpenAPI du backend.
// Régénéré via `pnpm generate:api` ; un drift fait échouer la CI (technique §2.3, §17.3).
export default defineConfig({
  rouxquizz: {
    input: '../backend/openapi/openapi.json',
    output: {
      mode: 'tags-split',
      target: 'src/api/generated',
      schemas: 'src/api/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      prettier: true,
      baseUrl: '/api/v1',
    },
  },
});
