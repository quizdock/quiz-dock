import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

describe('Markdown — block profile', () => {
  it('renders bold, italic, lists and code; links are unwrapped to their text', () => {
    const { container } = render(
      <Markdown>
        {'Un **gras** et _italique_\n\n- a\n- b\n\n[lien](https://x.test) `code`'}
      </Markdown>,
    );
    expect(container.querySelector('strong')?.textContent).toBe('gras');
    expect(container.querySelector('em')?.textContent).toBe('italique');
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('lien');
  });

  it('unwraps elements outside the allowlist (headings) and keeps their text', () => {
    const { container } = render(<Markdown>{'# Titre'}</Markdown>);
    expect(container.querySelector('h1')).toBeNull();
    expect(container.textContent).toContain('Titre');
  });

  it('renders images served by this app only (no third-party image)', () => {
    const { container } = render(
      <Markdown>
        {
          '![a](/api/v1/media/01ARZ3NDEKTSV4RRFFQ69G5FAV)\n\n![b](https://x.test/i.png)\n\n![c](/api/v1/media/../../x)'
        }
      </Markdown>,
    );
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('/api/v1/media/01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });

  it('drops raw HTML and never emits a link, even a javascript: one', () => {
    const { container } = render(
      <Markdown>{'<script>alert(1)</script><b>x</b> [j](javascript:alert(1))'}</Markdown>,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).not.toContain('alert');
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders nothing for an empty or null value', () => {
    expect(render(<Markdown>{null}</Markdown>).container.innerHTML).toBe('');
    expect(render(<Markdown>{''}</Markdown>).container.innerHTML).toBe('');
  });
});

describe('Markdown — inline profile', () => {
  it('keeps bold/italic/code, strips paragraphs and lists', () => {
    const { container } = render(
      <Markdown profile="inline">{'**A** _b_ `c` [l](https://x.test)\n\n- item'}</Markdown>,
    );
    expect(container.firstElementChild?.tagName).toBe('SPAN');
    expect(container.querySelector('strong')?.textContent).toBe('A');
    expect(container.querySelector('em')?.textContent).toBe('b');
    expect(container.querySelector('code')?.textContent).toBe('c');
    expect(container.querySelector('p')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('ul')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('l');
    expect(container.textContent).toContain('item');
  });
});
