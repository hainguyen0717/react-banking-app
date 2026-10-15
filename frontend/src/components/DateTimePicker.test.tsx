import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateTimePicker } from './DateTimePicker';

const fixedNow = () => new Date(2026, 9, 15, 10, 0, 0);

describe('DateTimePicker', () => {
  it('uses a button-triggered accessible dialog with no editable date input', () => {
    render(<DateTimePicker value={null} onChange={() => {}} now={fixedNow} />);
    expect(screen.queryByDisplayValue(/2026/)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="date"], input[type="datetime-local"], input[type="text"]')).toBeNull();
    fireEvent.click(screen.getByTestId('scheduled-transfer-date-time-trigger'));
    expect(screen.getByRole('dialog', { name: /choose transfer date and time/i })).toBeInTheDocument();
    expect(screen.getByTestId('date-time-picker-heading')).toHaveFocus();
    expect(screen.getByTestId('date-time-picker-day-2026-10-14')).toBeDisabled();
    expect(screen.getByTestId('date-time-picker-day-2026-10-15')).toBeEnabled();
  });

  it('converts the local selection to ISO and returns focus after confirmation', () => {
    const onChange = vi.fn();
    render(<DateTimePicker value={null} onChange={onChange} now={fixedNow} />);
    const trigger = screen.getByTestId('scheduled-transfer-date-time-trigger');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('date-time-picker-day-2026-10-16'));
    fireEvent.change(screen.getByTestId('date-time-picker-hour'), { target: { value: '09' } });
    fireEvent.change(screen.getByTestId('date-time-picker-minute'), { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('date-time-picker-confirm'));
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 9, 16, 9, 30, 0).toISOString());
    expect(trigger).toHaveFocus();
  });

  it('contains keyboard focus, closes on Escape and restores the trigger', () => {
    const onChange = vi.fn();
    render(<DateTimePicker value={null} onChange={onChange} now={fixedNow} />);
    const trigger = screen.getByTestId('scheduled-transfer-date-time-trigger');
    fireEvent.click(trigger);
    const confirm = screen.getByTestId('date-time-picker-confirm');
    fireEvent.keyDown(screen.getByTestId('date-time-picker-heading'), { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(screen.getByTestId('date-time-picker-previous-month')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('date-time-picker-dialog'), { key: 'Escape' });
    expect(screen.queryByTestId('date-time-picker-dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });
});
