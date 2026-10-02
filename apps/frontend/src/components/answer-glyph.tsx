import { glyphOf } from '@quiz-dock/contracts';
import { ShapeIcon } from '@/components/shape-icon';
import { appConfig } from '../config';

/**
 * What stands beside an answer's colour on the live screens: its shape, or —
 * as the instance's answer theme says (`ANSWER_THEME`) — its letter or number
 * by position, the same on the projection, the phones and the console.
 */
export function AnswerGlyph({
  shape,
  index,
  className,
}: {
  shape: string;
  /** Its place among the question's answers (A for the first). */
  index: number;
  className?: string;
}) {
  const text = glyphOf(appConfig.answerGlyph ?? 'shape', index);
  return text === null ? (
    <ShapeIcon shape={shape} className={className} />
  ) : (
    <span className={className ? `${className} font-bold` : 'font-bold'}>{text}</span>
  );
}
