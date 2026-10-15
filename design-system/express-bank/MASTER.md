# Express Bank design system

This file is the source of truth for Express Bank. Page files may add tighter rules, but must not contradict these global decisions.

The authenticated product uses restrained Glassmorphism. This is the user's selected UI/UX Pro Max style. The design-system aggregator returned a generic Minimalism result for the same query; that broad result does not override the exact Glassmorphism style match or the user's choice.

## Visual direction

- Use a deep navy-to-blue background with subtle blue/cyan ambient light. Do not use purple or pink gradients.
- Use translucent surfaces at approximately 15–30% tint opacity, 10–20px backdrop blur, a subtle 1px light border, and consistent layered shadows.
- Keep hierarchy selective: the shell, top bar, navigation, primary data cards, forms, messages, and dialogs may be glass. Avoid stacking decorative glass layers inside every component.
- Always provide an opaque navy fallback before the `backdrop-filter` feature query.
- Keep IBM Plex Sans for headings and body copy, tabular numerals for balances, and a 4/8px spacing rhythm.

## Core tokens

| Role | Value |
| --- | --- |
| Background | `#041022` |
| Raised background | `#0A1B33` |
| Opaque surface fallback | `#102846` |
| Glass surface | `rgba(86, 142, 199, 0.20)` |
| Strong glass surface | `rgba(72, 127, 184, 0.28)` |
| Glass border | `rgba(191, 219, 254, 0.30)` |
| Primary text | `#F8FBFF` |
| Secondary text | `#C4D2E4` |
| Accent | `#7DD3FC` |
| Strong accent | `#60A5FA` |
| Focus | `#BAE6FD` with a visible outer ring |
| Success text | `#86EFAC` |
| Destructive text | `#FDA4AF` |
| Surface blur | `16px` (allowed range 10–20px) |

Normal text must maintain at least 4.5:1 contrast against the composed surface, not merely the raw translucent token. Meaningful boundaries and focus indicators must remain visible over both the fallback and blurred backgrounds.

## Components and interaction

- Buttons and links use stable bounds. Hover, active, and pressed feedback may change color, border, or shadow, but must not translate or scale the control.
- Only enabled controls use the pointer cursor. Disabled controls retain native semantics, reduced emphasis, and `not-allowed` cursor.
- Inputs use dark, high-opacity control surfaces within glass cards so labels and entered values remain legible.
- Active navigation combines a text label, stronger border, surface treatment, and `aria-current`; color is not the sole indicator.
- Status, success, error, and destructive states always include clear text plus a distinct border/surface treatment.
- Dialogs use a strong glass surface over a dark scrim, visible labels/descriptions, initial focus, Escape dismissal where safe, focus containment, and focus restoration.
- Use CSS/React only. Do not add animation, icon, or UI dependencies, and do not use emoji as structural icons.

## Accessibility and responsive behavior

- Preserve logical DOM and keyboard order, semantic headings/landmarks, accessible names, and stable `data-testid` locators.
- Use a strong, visible focus treatment on every interactive element. Sticky navigation and overlays must not obscure focused controls.
- Respect `prefers-reduced-motion`; the interface remains fully understandable without transitions.
- Support 375px, 768px, 1024px, and 1440px without horizontal page overflow. Controls and dialogs wrap deliberately, and touch controls are at least 44px high where practical.
- Desktop navigation remains sticky. At tablet widths it reflows above content; on narrow screens it becomes a single-column sequence without changing DOM order.
- Authentication pages retain their current structure. Dashboard-specific background, glass, and focus tokens must not cause an unintended public-page redesign.

## Forbidden patterns

- Purple/pink AI gradients, low-contrast gray text, excessive nested glass, layout-shifting hover transforms, emoji icons, animation frameworks, and motion required to understand state.
- Color-only state, hidden focus outlines, disabled controls that appear enabled, fixed-width layouts that overflow, or transparent surfaces without an opaque fallback.
