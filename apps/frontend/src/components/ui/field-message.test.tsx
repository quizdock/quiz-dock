import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FieldMessage } from './field-message';

describe('FieldMessage', () => {
  it('an error is announced as it appears; what is left to finish stays quiet', () => {
    render(
      <FieldMessage
        issues={[
          { field: 'prompt', text: 'The question needs a text.', tone: 'error' },
          { field: 'alt', text: 'A picture misses its description.', tone: 'warning' },
        ]}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The question needs a text.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
