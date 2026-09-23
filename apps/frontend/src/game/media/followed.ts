import type { GameView } from '../use-game-session';
import type { FollowedPosition } from './question-media-stage';

/** The projection's last position in the sound of `questionIndex`, or null when none yet. */
export function followed(view: GameView, questionIndex: number): FollowedPosition | null {
  const position = view.mediaPosition;
  return position && position.questionIndex === questionIndex ? position : null;
}
