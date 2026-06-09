import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/**
 * Construit le document OpenAPI. Partagé entre le serveur (main.ts, route /api/docs)
 * et le générateur statique (openapi.ts, consommé par Orval). Voir technique §2.3.
 */
export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Roux-Quizz API')
    .setDescription('API REST du builder de quiz et des restitutions')
    .setVersion('0.1.0')
    .build();
  return SwaggerModule.createDocument(app, config);
}
