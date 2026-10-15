import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import styles from './DateTimePicker.module.css';

interface DateTimePickerProps {
  value: string | null;
  onChange: (isoValue: string) => void;
  now?: () => Date;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysForMonth(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return { leading: first.getDay(), days: Array.from({ length: count }, (_, index) => index + 1) };
}

export function DateTimePicker({ value, onChange, now = () => new Date() }: DateTimePickerProps) {
  const initial = value ? new Date(value) : new Date(now().valueOf() + 60 * 60 * 1000);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(() => dateKey(initial));
  const [hour, setHour] = useState(() => String(initial.getHours()).padStart(2, '0'));
  const [minute, setMinute] = useState(() => String(Math.ceil(initial.getMinutes() / 5) * 5 % 60).padStart(2, '0'));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const wasOpenRef = useRef(false);
  const calendar = useMemo(() => daysForMonth(month), [month]);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      headingRef.current?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  function close() {
    setOpen(false);
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function selectedDate() {
    const [year, monthNumber, day] = selectedDay.split('-').map(Number);
    return new Date(year, monthNumber - 1, day, Number(hour), Number(minute), 0, 0);
  }

  const chosen = selectedDate();
  const canConfirm = chosen > now();
  const formatted = value
    ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : 'Choose date and time';

  return (
    <div className={styles.picker} data-testid="date-time-picker">
      <button ref={triggerRef} className={styles.trigger} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} data-testid="scheduled-transfer-date-time-trigger">
        {formatted}
      </button>
      {open ? (
        <div className={styles.backdrop} data-testid="date-time-picker-backdrop">
          <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="date-time-picker-heading" onKeyDown={handleDialogKeyDown} data-testid="date-time-picker-dialog">
            <h3 ref={headingRef} id="date-time-picker-heading" tabIndex={-1} data-testid="date-time-picker-heading">Choose transfer date and time</h3>
            <div className={styles.monthNav} data-testid="date-time-picker-month-nav">
              <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} data-testid="date-time-picker-previous-month" aria-label="Previous month">‹</button>
              <strong data-testid="date-time-picker-month-label">{month.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</strong>
              <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} data-testid="date-time-picker-next-month" aria-label="Next month">›</button>
            </div>
            <div className={styles.weekdays} aria-hidden="true" data-testid="date-time-picker-weekdays">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day} data-testid={`date-time-picker-weekday-${day.toLowerCase()}`}>{day}</span>)}
            </div>
            <div className={styles.calendar} role="grid" aria-label="Calendar" data-testid="date-time-picker-calendar">
              {Array.from({ length: calendar.leading }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" data-testid={`date-time-picker-leading-blank-${index}`} />)}
              {calendar.days.map((day) => {
                const candidate = new Date(month.getFullYear(), month.getMonth(), day);
                const isoDay = dateKey(candidate);
                const today = now();
                const disabled = candidate < new Date(today.getFullYear(), today.getMonth(), today.getDate());
                return (
                  <button key={isoDay} className={selectedDay === isoDay ? styles.selected : undefined} type="button" role="gridcell" disabled={disabled} aria-selected={selectedDay === isoDay} onClick={() => setSelectedDay(isoDay)} data-testid={`date-time-picker-day-${isoDay}`}>
                    {day}
                  </button>
                );
              })}
            </div>
            <div className={styles.timeFields} data-testid="date-time-picker-time-fields">
              <label htmlFor="date-time-picker-hour" data-testid="date-time-picker-hour-label">Hour
                <select id="date-time-picker-hour" value={hour} onChange={(event) => setHour(event.target.value)} data-testid="date-time-picker-hour">
                  {Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')).map((item) => <option key={item} value={item} data-testid={`date-time-picker-hour-option-${item}`}>{item}</option>)}
                </select>
              </label>
              <label htmlFor="date-time-picker-minute" data-testid="date-time-picker-minute-label">Minute
                <select id="date-time-picker-minute" value={minute} onChange={(event) => setMinute(event.target.value)} data-testid="date-time-picker-minute">
                  {Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0')).map((item) => <option key={item} value={item} data-testid={`date-time-picker-minute-option-${item}`}>{item}</option>)}
                </select>
              </label>
            </div>
            {!canConfirm ? <p role="alert" data-testid="date-time-picker-future-error">Choose a future date and time.</p> : null}
            <div className={styles.actions} data-testid="date-time-picker-actions">
              <button type="button" onClick={close} data-testid="date-time-picker-cancel">Cancel</button>
              <button type="button" disabled={!canConfirm} onClick={() => { onChange(chosen.toISOString()); close(); }} data-testid="date-time-picker-confirm">Use this time</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
