# Publishing notes

Nothing in this repo has been pushed or published. These are the notes for doing that.

## GitHub description (one line)

Free n8n kit: text back every missed call with a booking link, respect opt outs and quiet hours, get a daily report. Tested end to end in Docker.

## Topics

`n8n` `n8n-workflow` `workflow-automation` `twilio` `sms` `missed-calls` `restaurant` `popia` `south-africa` `postgres` `typescript` `vitest`

## Before making it public

- [ ] Create the repo as `n8n-missed-call-recovery` under your account, so the clone URL in the README works.
- [ ] Push `main`. The CI workflow in `.github/workflows/ci.yml` then runs lint, typecheck, the drift check, tests with coverage, the demo, and the Docker e2e run. It has not run on GitHub yet.
- [ ] Read the README once on GitHub and check that the Mermaid diagram renders.
- [ ] Decide whether to keep this file in the public repo.

## Checklist for a live demo (accounts you create yourself)

The repo needs no accounts: `npm run demo` and `npm run e2e` use mocks. A live demo with a real phone needs:

- [ ] **n8n**: a self hosted n8n (free community edition) or an n8n Cloud account. It must be reachable from the internet so Twilio can call it.
- [ ] **Postgres**: any Postgres you control, for example a free tier project at Neon or Supabase. Run `sql/schema.sql` once.
- [ ] **Twilio account** with a number that can make calls and send and receive SMS in South Africa. Check the number's capabilities before buying. South African numbers can need a regulatory bundle with documents, which takes time. Trial accounts only text verified numbers and add a trial notice to each message. Messaging geo permissions: South Africa only.
- [ ] **Slack app** (optional): create an app, add the `chat:write` bot scope, install it, copy the bot token into the n8n Header Auth credential, and invite the bot to the alerts channel. Or use the SMTP credential and email instead.
- [ ] Follow "Set it up in 10 minutes" in the README. Use `npm run build -- --env --out dist/live` with your values in `KIT_*` variables (see `.env.example`) to build ready-to-import copies.
- [ ] Test on your own phone first: call, let it ring out, reply YES, tap the link, reply STOP, call again and confirm no text arrives.

Costs: Twilio charges per SMS and per number after trial credit. n8n Cloud is paid after its trial. Everything else above has a free option.

## Secret scan

Run on 21 October 2026, over the full git history (`--all`).

- **gitleaks v8.30.1** (official Docker image, repo mounted read only): **no leaks found.**
  The first run flagged 8 `generic-api-key` findings. All 8 were the made up test token `abc123def456` in `test/nodes.test.ts` and `test/parity.test.ts`. Those values now live in `test/fixtures.ts` with `gitleaks:allow` markers, and the local commit was amended before anything was pushed. The rerun is clean.
- **Regex scan** of every commit's full patch, 14 patterns:
  - 0 hits: AWS keys, Twilio API keys, Twilio auth tokens, Slack tokens, Slack webhooks, GitHub tokens, Stripe live keys, Anthropic and OpenAI keys, Google API keys, private keys, JWTs, password literals.
  - 0 real looking South African mobile numbers. Every number in the repo uses the fake `+27 00 000 00xx` pattern (plus one fake `+44 000 000 0000`).
  - 4 hits for "URL with credentials": all are the documented placeholder `https://USER:PASSWORD@your-n8n...`.
  - The Twilio Account SID `AC00000000000000000000000000000000` in the e2e config and mocks is an all zero dummy. Account SIDs are identifiers, not secrets.
- The e2e run creates its passwords and n8n encryption key at random for each run, writes them to `docker/.e2e/` (gitignored) and deletes that folder when the stack stops.
