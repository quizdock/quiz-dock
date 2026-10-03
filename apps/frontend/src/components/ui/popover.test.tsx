import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Drawer } from './drawer';
import { Popover } from './popover';

function Menu() {
  return (
    <Popover
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle}>
          More
        </button>
      )}
    >
      <button type="button">Archive</button>
      <button type="button">Delete</button>
    </Popover>
  );
}

describe('Popover, with the keyboard', () => {
  it('takes the focus when it opens, and gives it back to its trigger on Escape', async () => {
    render(<Menu />);
    const trigger = screen.getByRole('button', { name: 'More' });
    trigger.focus();
    fireEvent.click(trigger);
    await act(async () => {});
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the focus leaves it', async () => {
    render(
      <>
        <Menu />
        <button type="button">Elsewhere</button>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await act(async () => {});
    fireEvent.focusOut(screen.getByRole('button', { name: 'Delete' }), {
      relatedTarget: screen.getByRole('button', { name: 'Elsewhere' }),
    });
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('an Escape that closes a menu in a drawer leaves the drawer open', async () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Question" onClose={onClose}>
        <Menu />
      </Drawer>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await act(async () => {});
    fireEvent.keyDown(screen.getByRole('button', { name: 'Archive' }), {
      key: 'Escape',
      code: 'Escape',
    });
    expect(onClose).not.toHaveBeenCalled();
    // The next Escape is the drawer's.
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
