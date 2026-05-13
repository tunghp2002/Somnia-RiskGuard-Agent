# Story 3.2: Send Risk Alerts With Explanation And Buttons

Status: done

## Story

As a user,
I want Telegram risk alerts with clear explanations and quick actions,
so that I can respond without opening the dashboard.

## Acceptance Criteria

1. Given a risk threshold is crossed, when the alert service sends a Telegram message, then the message includes Risk Score, short explanation, severity, and quick action buttons.
2. Given a Telegram send fails, when the failure is caught, then the agent records a diagnostic log and audit event and does not retry unsafe actions automatically.

## Tasks / Subtasks

- [x] Add alert persistence.
- [x] Add risk alert formatting and quick-action button generation.
- [x] Integrate alert dispatch after portfolio risk analysis.
- [x] Add tests for alert success and failed delivery audit behavior.

## Dev Agent Record

### Completion Notes List

- Implemented as part of `spec-full-epic-3.md`.
- Alert delivery is skipped when Telegram is unhealthy or no binding exists.

### File List

- `agent/src/persistence/alerts.repository.ts`
- `agent/src/services/telegram-alert.service.ts`
- `agent/src/jobs/portfolio-monitor.job.ts`
- `agent/src/jobs/portfolio-monitor.job.test.ts`
- `agent/src/services/telegram-alert.service.test.ts`

### Change Log

- 2026-05-13: Implemented Story 3.2.
