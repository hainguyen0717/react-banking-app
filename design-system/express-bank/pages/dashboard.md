# Dashboard page rules

These rules refine the [Express Bank master design system](../MASTER.md) for the authenticated dashboard and do not replace its accessibility requirements.

## Navigation hierarchy

- Accounts is a grouped destination containing Accounts overview, New account, and New joint account.
- Cards is a standalone primary destination immediately after Accounts and before the Transfer group. It is never nested under Accounts.
- Transfer contains Transfer, Schedule transfer, and Scheduled transfers. Profile remains its own group.
- Preserve query-backed deep links, active `aria-current` state, and DOM order at every breakpoint.

## Glass hierarchy

- Apply glass to the authenticated shell's top bar, navigation, total-balance summary, primary account/card/form surfaces, status/error surfaces, and dialogs.
- Use the master 16px blur and 20–28% surface tints. Controls inside those surfaces use a darker, more opaque fill rather than another decorative glass layer.
- Data cards may increase border contrast and shadow on hover without translation, scaling, or reflow.
- Card-disable and date/time dialogs use a strong glass surface, dark scrim, clear text, contained keyboard focus, Escape cancellation, and focus restoration.

## Responsive behavior

- At 1440px, use the full centered content width and sticky left navigation.
- At 1024px and below, reflow navigation above the dashboard content while preserving source order.
- At 768px and below, stack navigation groups and wrap headings/actions deliberately.
- At 375px, use compact gutters, single-column card rows, wrapping actions, and viewport-contained dialogs with no horizontal page overflow.

## Accessibility

- Primary and muted text meet 4.5:1 contrast on the composed glass surface and opaque fallback.
- Active, selected, loading, success, error, and destructive states include text and non-color treatment.
- All enabled interactive controls have clear hover/pressed feedback and a strong focus ring; disabled controls use native semantics and visibly reduced emphasis.
- Reduced-motion mode removes nonessential transitions without hiding content or state.
