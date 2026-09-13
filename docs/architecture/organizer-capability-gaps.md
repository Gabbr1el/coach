# Organizer capability gaps

These capabilities are intentionally not callable because the current authoritative schemas cannot represent them safely:

- `plan.reserveBlock`: there is no persisted reserve-block entity or service. The Organizer responds with "reserva de bloco ainda não suportada" and may only show review needs read-only.
- `plan.moveItem`: the weekly planner has no authoritative manual-move operation.
- `availability.workingUntil`: weekday availability stores minutes, not a work-end time.
- `availability.vacationUntil`: availability has no exact vacation interval model.

The callable registry must not include these names. Approximate fields, routine notes, and synthetic actions are not substitutes.
