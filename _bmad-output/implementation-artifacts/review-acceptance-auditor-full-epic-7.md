# Acceptance Auditor Review Prompt - Full Epic 7

Use the `bmad-review-adversarial-general` skill with acceptance-audit stance.

Inputs:

- Diff: `review-diff-full-epic-7.patch`
- Spec: `spec-full-epic-7.md`
- Context docs from spec frontmatter:
  - `epic-7-context.md`
  - `../planning-artifacts/epics.md`
  - `../planning-artifacts/ux-design-specification.md`
  - `../../.agents/skills/shadcn-ui-design-system/SKILL.md`

Check the patch against every acceptance criterion and implementation rule in the spec/context. Pay special attention to dashboard IA, mobile bottom navigation plus More sheet, Telegram Connect replacing manual chat-id UX, public chain metadata from `config/public-chains.json`, demo/testnet labeling, Somnia adapter gating, and verification claims.

Return findings ordered by severity with exact acceptance criterion or rule violated.
