import { createZodDto } from 'nestjs-zod';
import { questionContentSchema } from './question-content.schema';

/** Ajout d'une question à un quiz (contenu validé par type). */
export class CreateQuestionDto extends createZodDto(questionContentSchema) {}
