# FailSafe — Engineering Operating Instructions

## 1. Source of truth

- `docs/BUILD_BLUEPRINT.md` is the authoritative product and engineering specification.
- `docs/PROGRESS.md` is the persistent implementation journal.
- Never rely on previous conversation context for task completion.
- Read both files from disk at the beginning of every work cycle.

## 2. Execution protocol

For every implementation cycle:

1. Identify the first unchecked task whose dependencies are complete.
2. State the task ID and its acceptance criteria.
3. Assign implementation to the appropriate specialist.
4. Implement only that task.
5. Write tests for new behavior.
6. Run task-specific verification.
7. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
8. Request independent QA review.
9. Fix any reported failures.
10. Mark the task complete only after all checks pass.
11. Append factual evidence to `docs/PROGRESS.md`.
12. Commit the verified implementation.

Stop after completing one task. Do not silently move on to the next task.

## 3. Agent responsibilities

- Planner: analyzes requirements and dependencies.
- Frontend: owns UI, components, styling and frontend tests.
- Backend: owns domain logic, database, APIs and backend tests.
- QA: independently verifies acceptance criteria and implementation.

The main session is the orchestrator and integration owner.

Agents must not independently change another agent's assigned files without coordination.

## 4. Technical constraints

- Follow the stack and architecture in BUILD_BLUEPRINT.md.
- Use TypeScript and Zod for typed data validation.
- Store financial amounts in integer cents.
- Never convert unknown financial values to zero.
- Every graph edge and risk assertion must have provenance.
- Suggested dependencies must never be treated as confirmed.
- Keep risk calculations deterministic.
- Keep the demo functional without external API keys.

## 5. Safety constraints

- Never request, expose or store card PAN or CVV.
- Never call Ramp write endpoints.
- Never claim a simulated action changed live financial data.
- Never fabricate production data or external integration success.
- Never silently fall back from a failed live integration to mock data.
- Treat LLM outputs as suggestions, not verified facts.
- Require human approval for external actions and deployments.

## 6. Quality standards

- No fake buttons or nonfunctional UI.
- No hardcoded dashboard metrics.
- No untraceable graph relationships.
- No unnecessary dependencies.
- No unrelated refactoring.
- Every task must have reproducible verification.

## 7. Reporting

At the end of each cycle, report:

- Task ID
- Implementation summary
- Files changed
- Tests and commands executed
- QA verdict
- Known limitations
- Git commit
- Next eligible task
