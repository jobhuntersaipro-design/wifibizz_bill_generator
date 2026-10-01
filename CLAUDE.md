# Your Project Name
Project descriptions

## Context Files
Read the following to get the full context of the project:
- @context/project-overview.md
- @context/coding-standard.md
- @context/ai-interaction.md
- @context/current-feature.md

## Commands
- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run lint` — run ESLint (flat config, `eslint.config.mjs`)



## Production verification
- After every merge that deploys, open the change on bizzflow.top and show proof (a screenshot of the
  changed screen, plus the deployment id serving it). "Build passed" is not proof it works on production.
- If signing in to production is not possible from the session, say so and ask the user for a way in;
  never report a change as live on production without having looked at it there.

## Reply shape
- First sentence = result.
- No restating the task. No “I’ll now…”. No closing recap.
- Between tools: one short status line only if direction changed.
- After edits: files changed, behavior change, tests run, leftover risk.
- If I ask for detail, then expand.
