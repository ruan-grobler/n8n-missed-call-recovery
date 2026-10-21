# Live setup

The repo needs no accounts: `npm run demo` and `npm run e2e` use mocks. A live demo with a real phone needs:

- [ ] **n8n**: a self hosted n8n (free community edition) or an n8n Cloud account. It must be reachable from the internet so Twilio can call it.
- [ ] **Postgres**: any Postgres you control, for example a free tier project at Neon or Supabase. Run `sql/schema.sql` once.
- [ ] **Twilio account** with a number that can make calls and send and receive SMS in South Africa. Check the number's capabilities before buying. South African numbers can need a regulatory bundle with documents, which takes time. Trial accounts only text verified numbers and add a trial notice to each message. Messaging geo permissions: South Africa only.
- [ ] **Slack app** (optional): create an app, add the `chat:write` bot scope, install it, copy the bot token into the n8n Header Auth credential, and invite the bot to the alerts channel. Or use the SMTP credential and email instead.
- [ ] Follow "Set it up in 10 minutes" in the README. Use `npm run build -- --env --out dist/live` with your values in `KIT_*` variables (see `.env.example`) to build ready-to-import copies.
- [ ] Test on your own phone first: call, let it ring out, reply YES, tap the link, reply STOP, call again and confirm no text arrives.

Costs: Twilio charges per SMS and per number after trial credit. n8n Cloud is paid after its trial. Everything else above has a free option.

