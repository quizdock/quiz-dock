import { MESSAGE_BURST, MESSAGES_PER_S, messageBudget } from './game.gateway';

describe('messageBudget', () => {
  it('lets a burst through, then the refill rate, and drops the rest', () => {
    let t = 0;
    const budget = messageBudget(() => t);
    const next = jest.fn();
    for (let i = 0; i < MESSAGE_BURST + 10; i++) budget([], next);
    expect(next).toHaveBeenCalledTimes(MESSAGE_BURST);
    t += 1000; // a second later: that second's share again
    for (let i = 0; i < MESSAGES_PER_S + 10; i++) budget([], next);
    expect(next).toHaveBeenCalledTimes(MESSAGE_BURST + MESSAGES_PER_S);
  });
});
