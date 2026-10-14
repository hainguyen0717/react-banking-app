# Dashboard Page Overrides

> **PROJECT:** Express Bank
> **Generated:** 2026-10-14 15:26:43
> **Page Type:** Dashboard / Data View

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1400px or full-width
- **Desktop Grid:** Sticky left function navigation with a flexible content column.
- **Responsive:** Keep the same navigation DOM and place it statically above content, wrapping groups as space narrows.
- **Content Views:** Render one selected panel at a time; the URL query parameter is the source of truth for the visible view.

### Spacing Overrides

- **Content Density:** High — optimize for information display

### Typography Overrides

- No overrides — use Master typography

### Color Overrides

- No overrides — use Master colors

### Component Overrides

- No overrides — use Master component specs

---

## Page-Specific Components

- **Grouped Function Navigation:** `Accounts` contains `Accounts overview` and `New account`; `Transfer` contains `Transfer`.
- **Navigation Links:** Minimum 44px target height, visible hover/focus/current states, semantic lists, and `aria-current="page"` on the selected link.
- **Deep Links:** Use `/dashboard?view=accounts`, `/dashboard?view=new-account`, and `/dashboard?view=transfer`; missing or invalid values fall back to accounts.
- **State Continuity:** Query-only navigation must not remount the dashboard or clear loaded accounts, history, or partially completed forms.
- **Skip Link:** Targets the selected content container at `#dashboard-content`.

---

## Recommendations

- Effects: Subtle hover (200-250ms), smooth transitions, sharp shadows if any, clear type hierarchy, fast loading
- Preserve the Master dark navy, gold, and IBM Plex Sans visual direction.
- Do not introduce a drawer or a second mobile navigation pattern; the sidebar reflows above the content.
