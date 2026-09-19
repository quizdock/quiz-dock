import { slideContentSchema } from './slide-content.schema';

describe('slideContentSchema', () => {
  it('text outline is on by default (readable over any background)', () => {
    const parsed = slideContentSchema.parse({
      blocks: [{ type: 'heading', id: 'h', text: 'Hello' }],
    });
    expect(parsed.textOutline).toBe(true);
    expect(parsed.textTone).toBe('light');
  });

  it('refuses an empty slide and a double background', () => {
    expect(slideContentSchema.safeParse({}).success).toBe(false);
    expect(
      slideContentSchema.safeParse({
        mediaId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        gradient: { angle: 0, colors: ['#000000', '#ffffff'] },
      }).success,
    ).toBe(false);
  });
});
