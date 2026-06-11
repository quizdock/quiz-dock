import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

/**
 * Construit le document OpenAPI. Partagé entre le serveur (main.ts, route /api/docs)
 * et le générateur statique (openapi.ts, consommé par Orval). Voir technique §2.3.
 *
 * `cleanupOpenApiDoc` (nestjs-zod) post-traite le document pour y injecter
 * correctement les schémas des DTO Zod (createZodDto) — appelé dans les DEUX
 * bootstraps via cette fonction partagée.
 */
export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Roux-Quizz API')
    .setDescription('API REST du builder de quiz et des restitutions')
    .setVersion('0.1.0')
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}
