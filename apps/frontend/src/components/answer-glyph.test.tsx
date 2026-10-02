import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { appConfig } from '../config';
import { AnswerGlyph } from './answer-glyph';

describe('AnswerGlyph (ANSWER_THEME)', () => {
  afterEach(() => {
    appConfig.answerGlyph = undefined;
  });

  it("draws the author's shape by default", () => {
    const { container } = render(<AnswerGlyph shape="triangle" index={1} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('a letter or a number by position, as the instance says', () => {
    appConfig.answerGlyph = 'letter';
    render(<AnswerGlyph shape="triangle" index={1} />);
    expect(screen.getByText('B')).toBeInTheDocument();
    appConfig.answerGlyph = 'number';
    render(<AnswerGlyph shape="triangle" index={3} />);
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
