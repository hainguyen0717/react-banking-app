import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { delayActivityStore } from '../lib/delayActivity';
import { DelayBlocker } from './DelayBlocker';

afterEach(() => delayActivityStore.reset());

describe('DelayBlocker', () => {
  it('renders an accessible same-style countdown dialog, manages focus and restores it when complete', () => {
    render(<><button type="button">Before</button><DelayBlocker testIdPrefix="test-delay" /></>);
    screen.getByRole('button', { name: 'Before' }).focus();
    expect(screen.queryByTestId('test-delay')).not.toBeInTheDocument();
    let id: string | null = null;
    act(() => { id = delayActivityStore.start(2, 'api'); });
    expect(screen.getByRole('dialog', { name: 'Waiting for simulated delay' })).toBe(screen.getByTestId('test-delay'));
    expect(screen.getByTestId('test-delay-message')).toHaveTextContent('2 seconds remaining');
    expect(screen.getByTestId('test-delay-dialog')).toHaveFocus();
    act(() => delayActivityStore.finish(id));
    expect(screen.queryByTestId('test-delay')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
  });

  it('shows Completing when work continues beyond its sampled countdown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
    render(<DelayBlocker testIdPrefix="test-delay" />);
    act(() => { delayActivityStore.start(1, 'api'); });
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('test-delay-message')).toHaveTextContent('Completing…');
    vi.useRealTimers();
  });
});
