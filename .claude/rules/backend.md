# Backend Rules

- Validate all external input at the boundary.
- All DB access goes through Prisma; no raw SQL without a comment explaining why.
- Every schema change needs a migration — never edit applied migrations.
- Return consistent error shapes; never leak stack traces to clients.
- Secrets come from environment variables only.
