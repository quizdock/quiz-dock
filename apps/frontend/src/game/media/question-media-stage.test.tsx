import type { LiveQuestionMedia } from '@quiz-dock/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { QuestionMediaStage } from './question-media-stage';

const video: LiveQuestionMedia = {
  visual: { kind: 'video', source: 'upload', url: '/api/v1/media/v', gainDb: 0 },
  audio: null,
};
const sound: LiveQuestionMedia = {
  visual: null,
  audio: { url: '/api/v1/media/a', durationMs: 4000, peaks: new Array(200).fill(0.5), gainDb: 0 },
};

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

beforeEach(() => {
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    return play(this) as Promise<void>;
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () {
    pause();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup(); // unmount (and release the elements) while the media stubs still stand
  vi.restoreAllMocks();
});

const refused = () => Object.assign(new Error('blocked'), { name: 'NotAllowedError' });

describe('QuestionMediaStage', () => {
  it('plays the video as the question appears, and stops it when the screen moves on', async () => {
    const { unmount } = render(<QuestionMediaStage media={video} mode="play" />);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    pause.mockClear();
    unmount();
    expect(pause).toHaveBeenCalled();
  });

  it('holds while the host pauses, and plays on when the game resumes', async () => {
    const { rerender } = render(<QuestionMediaStage media={sound} mode="play" />);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    rerender(<QuestionMediaStage media={sound} mode="pause" />);
    expect(pause).toHaveBeenCalled();
    rerender(<QuestionMediaStage media={sound} mode="play" />);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
  });

  it('never plays in the console (still)', async () => {
    render(<QuestionMediaStage media={sound} mode="still" />);
    await act(async () => undefined);
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByRole('img', { name: /Forme d’onde/ })).toBeInTheDocument();
  });

  it('a refused video plays muted and says so, with a way to turn the sound on', async () => {
    play.mockImplementationOnce(async () => {
      throw refused();
    });
    render(<QuestionMediaStage media={video} mode="play" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/sans le son/);
    const el = document.querySelector('video') as HTMLVideoElement;
    expect(el.muted).toBe(true);
    expect(play).toHaveBeenCalledTimes(2); // muted retry
    fireEvent.click(screen.getByRole('button', { name: /Activer le son/ }));
    await waitFor(() => expect(el.muted).toBe(false));
  });

  it('a refused sound is flagged, with a button', async () => {
    play.mockImplementationOnce(async () => {
      throw refused();
    });
    render(<QuestionMediaStage media={sound} mode="play" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Son bloqué/);
    expect(screen.getByRole('button', { name: /Activer le son/ })).toBeInTheDocument();
  });

  it('after an interruption, resumes a second before where it was', async () => {
    sessionStorage.setItem(
      'media.pos:123456:0:/api/v1/media/a',
      JSON.stringify({ t: 7, ended: false }),
    );
    render(<QuestionMediaStage media={sound} mode="play" resumeKey="123456:0" />);
    await waitFor(() => expect(play).toHaveBeenCalled());
    const el = play.mock.calls[0][0] as HTMLMediaElement;
    expect(el.currentTime).toBe(6);
    sessionStorage.clear();
  });

  it('the host takes it back to the top', async () => {
    const { rerender } = render(
      <QuestionMediaStage media={sound} mode="play" resumeKey="123456:0" restartSignal={0} />,
    );
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    const el = play.mock.calls[0][0] as HTMLMediaElement;
    el.currentTime = 5;
    rerender(
      <QuestionMediaStage media={sound} mode="play" resumeKey="123456:0" restartSignal={1} />,
    );
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(el.currentTime).toBe(0);
  });
  it('on a device the sound is not meant for: the video plays muted, a sound is left out', async () => {
    render(<QuestionMediaStage media={video} mode="play" audible={false} />);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect((play.mock.calls[0][0] as HTMLMediaElement).muted).toBe(true);
    cleanup();
    play.mockClear();
    const { container } = render(<QuestionMediaStage media={sound} mode="play" audible={false} />);
    await act(async () => undefined);
    expect(play).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('muted by its owner, it plays on silently, and gets its sound back', async () => {
    const { rerender } = render(<QuestionMediaStage media={sound} mode="play" muted />);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    const el = play.mock.calls[0][0] as HTMLMediaElement;
    expect(el.muted).toBe(true);
    rerender(<QuestionMediaStage media={sound} mode="play" muted={false} />);
    await waitFor(() => expect(el.muted).toBe(false));
  });
  it('draws the waveform at the size the author picked', async () => {
    const large = { ...sound, audio: { ...sound.audio!, size: 'L' as const } };
    render(<QuestionMediaStage media={large} mode="still" />);
    expect(screen.getByRole('img', { name: /Forme d’onde/ })).toHaveClass('h-[5em]');
  });
  it('the projection says where it is in the sound, for the other screens', async () => {
    const onPosition = vi.fn();
    render(<QuestionMediaStage media={sound} mode="play" onPosition={onPosition} />);
    await waitFor(() => expect(play).toHaveBeenCalled());
    const el = play.mock.calls[0][0] as HTMLMediaElement;
    el.dispatchEvent(new Event('pause'));
    expect(onPosition).toHaveBeenCalledWith(0, expect.any(Boolean));
  });

  it('a screen that does not play the sound draws it where the projection is, without loading it', async () => {
    render(
      <QuestionMediaStage
        media={sound}
        mode="still"
        follow={{ questionIndex: 0, t: 2, playing: false, receivedAt: performance.now() }}
      />,
    );
    await act(async () => undefined);
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByRole('img', { name: /Forme d’onde/ })).toBeInTheDocument();
  });
  it('a device that starts late jumps to where the projection is', async () => {
    render(
      <QuestionMediaStage
        media={sound}
        mode="play"
        catchUp={{ questionIndex: 0, t: 5, playing: true, receivedAt: performance.now() }}
      />,
    );
    await waitFor(() => expect(play).toHaveBeenCalled());
    const el = play.mock.calls[0][0] as HTMLMediaElement;
    el.dispatchEvent(new Event('playing'));
    expect(el.currentTime).toBeGreaterThanOrEqual(5);
  });
});
