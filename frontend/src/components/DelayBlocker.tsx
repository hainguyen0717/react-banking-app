import { useEffect, useRef } from 'react';
import { useDelayActivity } from '../lib/delayActivity';
import styles from './DelayBlocker.module.css';

export function DelayBlocker({ testIdPrefix = 'delay-blocker' }: { testIdPrefix?: string }) {
  const activity = useDelayActivity();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activity.active) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    let focusMovedOutside = false;
    const trackFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog?.contains(event.target)) focusMovedOutside = true;
    };
    document.addEventListener('focusin', trackFocus);
    return () => {
      document.removeEventListener('focusin', trackFocus);
      if (!focusMovedOutside && previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [activity.active]);

  if (!activity.active) return null;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-label="Waiting for simulated delay"
      aria-describedby={`${testIdPrefix}-message`}
      data-testid={testIdPrefix}
    >
      <div ref={dialogRef} className={styles.dialog} tabIndex={-1} data-testid={`${testIdPrefix}-dialog`}>
        <span className={styles.spinner} aria-hidden="true" data-testid={`${testIdPrefix}-spinner`} />
        <div className={styles.copy} data-testid={`${testIdPrefix}-copy`}>
          <strong data-testid={`${testIdPrefix}-title`}>Simulating a delay</strong>
          <span id={`${testIdPrefix}-message`} role="status" aria-live="polite" data-testid={`${testIdPrefix}-message`}>
            {activity.completing ? 'Completing…' : `${activity.remainingSeconds} ${activity.remainingSeconds === 1 ? 'second' : 'seconds'} remaining`}
          </span>
        </div>
      </div>
    </div>
  );
}
