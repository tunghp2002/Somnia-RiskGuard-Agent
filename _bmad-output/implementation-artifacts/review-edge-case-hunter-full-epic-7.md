# Edge Case Hunter Review Prompt - Full Epic 7

Use the `bmad-review-edge-case-hunter` skill.

Inputs:

- Diff: `review-diff-full-epic-7.patch`
- Project read access: repository root

Walk the changed runtime/config/API/dashboard paths for unhandled branching paths and boundary conditions. Focus on public chain config fallback behavior, Telegram Connect session behavior, account restore/disconnect states, dashboard section navigation, demo/testnet truthfulness, and smoke script failure modes.

Return only real unhandled edge cases. Include file path, trigger condition, expected behavior, and current observed/likely behavior.
