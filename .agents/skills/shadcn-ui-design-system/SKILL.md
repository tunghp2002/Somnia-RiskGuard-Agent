---
name: shadcn-ui-design-system
description: Use when planning, designing, or implementing frontend UI with shadcn/ui, Tailwind CSS, Radix primitives, lucide-react icons, and project-local component conventions.
---

# shadcn/ui Design System

Use this skill whenever a BMad agent designs UX, writes architecture notes for UI, or implements frontend surfaces in this repo.

## Project Baseline

- Frontend app: `{project-root}/frontend`
- shadcn config: `{project-root}/frontend/components.json`
- Local UI primitives path: `{project-root}/frontend/src/components/ui`
- Public chain config: `{project-root}/config/public-chains.json`
- Current style: `new-york`, React Server Components enabled, TypeScript enabled, lucide icon library.
- Component aliases:
  - `@/components`
  - `@/components/ui`
  - `@/lib`
  - `@/lib/utils`
- Utility: use `cn()` from `@/lib/utils` for class composition.

## UX Planning Rules

- Treat shadcn/ui as the default component system for new frontend work unless the user explicitly asks for another system.
- Specify real components, states, and variants, not abstract UI labels. For example: `Button`, `Card`, `Dialog`, `Tabs`, `Table`, `Badge`, `Alert`, `Tooltip`, `DropdownMenu`, `Sheet`, `Form`, `Input`, `Select`, `Switch`, `Slider`, `Progress`, `Skeleton`.
- Do not collapse all product functions into one overloaded screen. Use an app shell with persistent desktop sidebar navigation and mobile bottom navigation.
- Use top-level routes/sections for Overview, Setup, Risk, Heartbeat, Rewards, Safety Receipts, Demo, and Health. The Overview route summarizes status; detailed configuration and diagnostics live in their own sections.
- For operational dashboards, keep density high and visual noise low: compact panels, clear scan paths, restrained color, visible status hierarchy, and no marketing-style hero layout.
- Auth should feel like common modern web apps: connected/disconnected account state, account menu, sign out/disconnect action, session restoration, loading state, and clear expired-session handling.
- Telegram setup must be a connect flow, not a raw chat-id form. Prefer "Connect Telegram" leading to bot deep link, one-time code, QR/link fallback, connection status, and disconnect/reconnect controls.
- Prefer lucide icons for icon buttons and affordances. Pair icon-only controls with accessible labels/tooltips.
- Use 8px or smaller card radius unless an existing local component says otherwise.
- Design every component with loading, empty, error, disabled, focus, hover, and mobile states when relevant.
- Accessibility is part of the spec: keyboard navigation, focus rings, semantic labels, contrast, reduced motion, and screen-reader labels for icon-only actions.

## Implementation Rules

- Before adding a component, inspect `frontend/src/components/ui` and existing feature components to reuse local patterns.
- Add shadcn components through the shadcn CLI, not by hand-writing registry components. From the frontend app, prefer commands like `pnpm dlx shadcn@latest add sonner`, `pnpm dlx shadcn@latest add dialog`, or `pnpm dlx shadcn@latest add select` so dependencies, files, and registry conventions stay consistent.
- Hand-write UI only when the needed component is not available from shadcn, or when building a product-specific composition around installed shadcn primitives. In that case, follow shadcn conventions: Radix primitive when appropriate, CVA for variants when useful, `cn()` for class merging, `forwardRef` where the primitive pattern expects it.
- Keep reusable primitives in `frontend/src/components/ui`; keep product-specific compositions under `frontend/src/features/...`.
- Prefer shadcn/ui primitives over hand-rolled UI for navigation, auth menus, setup forms, status panels, dialogs, sheets, tables, tabs, toasts, and tooltips.
- Use Tailwind tokens and CSS variables already present in `frontend/src/app/globals.css` before adding new color systems.
- Do not introduce a second design system, CSS-in-JS library, or custom icon set for normal product UI.
- Read non-secret chain metadata such as chain id, RPC URL, explorer URL, native currency, and public contract addresses from `{project-root}/config/public-chains.json`. Keep only secrets such as private keys, bot tokens, LLM keys, and provider credentials in environment variables.
- Verify frontend changes with `pnpm --dir frontend lint` and, when behavior changes, a relevant browser/manual check.

## Output Expectations

When writing UX specs, include a short "shadcn/ui Component Plan" section that lists:

- components and variants
- interaction states
- responsive behavior
- accessibility requirements
- implementation location hints
- navigation placement for desktop sidebar and mobile bottom nav

When implementing UI, mention the shadcn primitives or local components used in the final summary.
