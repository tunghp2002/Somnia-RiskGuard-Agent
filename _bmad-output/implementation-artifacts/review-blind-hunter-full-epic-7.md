# Blind Hunter Review Prompt - Full Epic 7

Use the `bmad-review-adversarial-general` skill.

You get only this diff artifact and no product/spec context:

- `review-diff-full-epic-7.patch`

Review only what the diff shows. Prioritize concrete bugs, regressions, broken assumptions, security leaks, build/runtime risks, and missing tests that are visible from the patch itself. Do not infer requirements outside the diff.

Return findings ordered by severity. Include file path and changed code area for each finding.
