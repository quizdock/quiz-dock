import { createZodDto } from 'nestjs-zod';
import { questionContentSchema } from './question-content.schema';

/** Remplacement complet du contenu d'une question (options/réponses incluses). */
export class UpdateQuestionDto extends createZodDto(questionContentSchema) {}
