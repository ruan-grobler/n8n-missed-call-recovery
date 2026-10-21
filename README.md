# Missed Call Recovery for n8n (free edition)

Text back every missed call with a booking link, without texting at night, without double texts, and without ever ignoring an opt out.

Three importable n8n workflows, tested end to end in real n8n 2.44.5. MIT licensed.

## The business problem

A busy restaurant misses calls. At lunch and dinner the phone rings while everyone is plating, so it rings out or goes busy.
Each of those calls is a person who wanted to order or book. Many of them simply call the next place on the list.

Calling everyone back by hand does not happen on a Friday night. A text that arrives within seconds, with the booking link, does.

This kit does that for a fictional Cape Town pizzeria, **Harbour Slice**. Swap in your own name, number and booking link.

## Before and after

Measured on one synthetic Friday (40 missed calls) from `npm run demo`. The same day replayed through real n8n in Docker gives the identical report.

| | Before (no automation) | After (this kit) |
|---|---|---|
| Missed callers who got a booking link | 0 of 40 | **32 of 40** (29 the same day, 3 at 08:00 the next morning) |
| Booking link taps | 0 | **13** |
| Texts sent in quiet hours (21:00 to 08:00) | | 0 |
| Double texts | | 0 |
| Texts after an opt out | | 0 |

The 8 callers who got no text: 2 repeat callers who already had a text sent or waiting, 2 who had opted out, 2 with no caller ID, 1 foreign number and 1 landline that Twilio refused (the manager was alerted to call back).

**Estimate, not measured:** if 1 in 3 taps becomes an order worth R250, that is about 4 orders, about R1,000 for this one day. The two assumptions are in `src/sim/format.ts`. Use your own numbers.

All data is synthetic. Numbers are fake (`+27 00 000 00xx`) and the business is fictional.

## Quickstart

```bash
git clone https://github.com/ruan-grobler/n8n-missed-call-recovery.git && cd n8n-missed-call-recovery
npm install
npm run demo
```

`npm run demo` replays the synthetic day in a few seconds: 40 missed calls with quiet hours, duplicates, replies, opt outs and link taps. It prints what happened to every call, the daily report and 12 checks. No Docker, no accounts. The output is saved in [docs/demo-output.txt](docs/demo-output.txt).

With Docker running, `npm run e2e` does the same through real n8n 2.44.5, Postgres 17 and mock Twilio, Slack and email ([docs/e2e-output.txt](docs/e2e-output.txt)).

## How it works

```mermaid
flowchart LR
  subgraph W1["1. Capture and text back"]
    A["Twilio call status: no-answer, busy, failed"] --> B["Normalise number to E.164"]
    B --> C[("Claim the call once. Key: ParentCallSid or CallSid")]
    C --> D{"Decide"}
    D -->|duplicate callback| X["Do nothing"]
    D -->|opted out, withheld, foreign, repeat caller| N[("Log as not texted")]
    D -->|21:00 to 08:00| Q[("Queue until 08:00")]
    D -->|open hours| S["Send one SMS with a tracked booking link"]
    R["Every 15 min from 08:00"] --> RQ[("Release due texts, check opt outs again")] --> S
    S -->|accepted| L[("Log sent")]
    S -->|refused| F[("Log failed")] --> M["Alert manager in Slack or email"]
  end
  subgraph W2["2. Replies and link taps"]
    I["Inbound SMS"] --> K{"STOP, YES or BOOK, other"}
    K -->|STOP or OPT OUT| O[("Opt out list, checked before every send")]
    K -->|YES or BOOK| BL["Send the booking link again"]
    K -->|anything else| MA["Alert manager"]
    T["Tap on tracked link"] --> TC[("Count the first tap")] --> RD["Redirect to booking page"]
  end
  subgraph W3["3. Daily report at 08:00"]
    DR["Schedule 08:00"] --> CR[("Count yesterday")] --> RP["Report to Slack and email, counts only"] --> RT[("Delete rows older than 90 days, keep opt outs")]
  end
```

| File | What it does |
|---|---|
| [workflows/01-missed-call-capture.json](workflows/01-missed-call-capture.json) | Twilio status callback in. Normalises the number, claims the call, applies the rules, sends or queues one SMS, logs everything. Releases the quiet hours queue every 15 minutes from 08:00. |
| [workflows/02-replies-and-clicks.json](workflows/02-replies-and-clicks.json) | Inbound SMS in. STOP opts out, YES or BOOK gets the link again, anything else alerts the manager. Also counts taps on the tracked booking link and redirects. |
| [workflows/03-daily-report.json](workflows/03-daily-report.json) | At 08:00 posts yesterday's numbers to Slack and email, then applies the retention rule. |
| [sql/](sql/) | Every query the Postgres nodes run, one file each. |
| [src/](src/) | The logic of every Code node, in TypeScript with tests. `npm run build` writes it into the workflow JSON. |

The Code nodes are generated, not hand written. Each one is the TypeScript in `src/nodes/` plus the `src/logic/` files it imports, turned into plain JavaScript. A test fails if the JSON and the TypeScript ever drift apart, so the tested code is the code n8n runs.

## Set it up in 10 minutes

You need n8n (self hosted or n8n Cloud), a Postgres database (a free tier at Neon or Supabase works, or your own), a Twilio number that can send SMS, and Slack or an email account for alerts.

1. **Import** the three files in `workflows/` (n8n, Workflows, Import from file).
2. **Create the credentials** once and pick them on the nodes that ask:
   - *Missed call kit Postgres*: your database.
   - *Twilio API*: Basic Auth. User is your Account SID, password is your Auth Token.
   - *Missed call kit webhook login*: Basic Auth with a user name and a long random password you make up.
   - *Slack bot token*: Header Auth, name `Authorization`, value `Bearer ` plus your bot token (scope `chat:write`, invite the bot to the channel). Or turn Slack off and use email.
   - *Manager email (SMTP)*: only if `notify_email` is on.
3. **Fill in the Config node** in each workflow: business name, Twilio number, Account SID, booking link and `tracked_link_base` (your n8n URL plus `/webhook/hs/book`). To set all three at once, put the values in environment variables and run `npm run build -- --env --out dist/live`, then import from `dist/live/` instead (see [.env.example](.env.example)).
4. **Create the tables**: open workflow 1 and run *Run once: create tables*. Or paste [sql/schema.sql](sql/schema.sql) into your SQL editor.
5. **Point Twilio at workflow 1.** Your Twilio number forwards calls to the shop phone. In a TwiML Bin:
   ```xml
   <Response>
     <Dial timeout="20">
       <Number statusCallbackEvent="completed" statusCallback="https://USER:PASSWORD@your-n8n.example.com/webhook/hs/missed-call">+27...</Number>
     </Dial>
   </Response>
   ```
   USER and PASSWORD are the webhook login from step 2. Twilio sends them after n8n asks for them.
6. **Point Twilio at workflow 2.** On the number, set "A message comes in" to `https://USER:PASSWORD@your-n8n.example.com/webhook/hs/sms-reply` (POST).
7. **Publish** all three workflows. Call your number, let it ring out and check your phone.

Tip: in the Twilio console, limit Messaging geo permissions to South Africa. The kit only texts `+27` numbers by default (`allowed_country_prefixes`), which also guards against SMS pumping.

## The rules

| Situation | What happens |
|---|---|
| Missed call (no-answer, busy, failed) in open hours | One SMS within seconds with a tracked booking link |
| Missed call between 21:00 and 08:00 | Queued, sent at 08:00. Dropped if it is more than 16 hours old by then |
| Twilio sends the same callback twice, or the shop phone rings on two handsets | Ignored. The call key is ParentCallSid, else CallSid |
| Same caller again within 6 hours, or a text already waiting | Not texted again |
| Caller ID withheld (`anonymous` or `+266696687`) or unreadable | Logged, not texted |
| Number outside the allowed countries | Logged, not texted |
| Number on the opt out list | Never texted. Checked again at the 08:00 release |
| Reply STOP, UNSUBSCRIBE or OPT OUT (anywhere), or CANCEL, END or QUIT (whole message) | Opt out list. No further texts, not even a confirmation |
| Reply YES or BOOK | The booking link again, with the same tracking token |
| YES or BOOK from an opted out number | No text. The manager is told and can phone them |
| Any other reply | Sent to the manager in Slack or email |
| Tap on the booking link | First tap counted, then redirected. Link preview bots get a 403 and are not counted |

"Can I cancel my order?" and "No olives, remove mushrooms" reach the manager. They do not opt anyone out. All times, windows and lists are in the Config node.

## How it fails safely

- **Idempotency.** Every missed call is claimed once in Postgres with an `INSERT ... ON CONFLICT` on the call key. A retried or duplicate callback only bumps `callback_count`. Replies are keyed on MessageSid the same way.
- **No automatic SMS retry.** A timed out request to Twilio may already have been sent, and a retry would double text. So the SMS node never retries.
- **Dead letter.** When Twilio refuses a text, the row is marked `failed` with Twilio's reason (for example `'To' number is not a valid mobile number (Twilio error 21614)`) and the manager gets an alert to call back. Rows stuck mid send show up in the daily report.
- **Retries where they are safe.** Postgres steps retry 3 times. Slack and email retry 3 times and never block the reply to Twilio.
- **The queue survives restarts.** Queued texts live in Postgres. The release runs every 15 minutes from 08:00, so a restart at 08:00 only delays them.
- **Locked webhooks.** Every Twilio webhook needs the webhook login. A request without it gets a 401 challenge, which Twilio answers with the user and password from the URL.
- **The customer path never breaks.** The booking link always redirects, even if the database is down. Every handled path of the reply webhook answers Twilio with valid TwiML.
- **Loud when it cannot cope.** If Postgres stays down after its retries, the run fails and shows in n8n's executions list, and Twilio logs the error in its debugger. Nothing is texted blind.

## Real test output

From [docs/test-output.txt](docs/test-output.txt) (`npm run ci`: lint, typecheck, drift check, tests with coverage, all exit code 0):

```
 Test Files  16 passed (16)
      Tests  179 passed (179)
Statements   : 97.04% ( 1149/1184 )
Branches     : 87.79% ( 633/721 )
Functions    : 96.04% ( 267/278 )
Lines        : 97.23% ( 1056/1086 )
```

The tests cover the logic, every SQL file on PGlite (real Postgres in WebAssembly), the mocks, a drift check of the workflow JSON, and a run of every generated Code node in a sandbox with n8n style globals.

From [docs/e2e-output.txt](docs/e2e-output.txt) (`npm run e2e`, real n8n 2.44.5 in Docker):

```
Checks against the hand written answer key: 15 of 15 passed
PASS  Every call ends with the outcome in the answer key: 41 of 41 calls match
PASS  Exactly one text per texted call, none for the rest: 33 missed call texts for 33 texted calls
PASS  Duplicate webhooks send nothing twice: 4 duplicate callbacks and 1 duplicate reply, 0 extra texts
PASS  Answered calls are ignored: answered calls sent no text
PASS  No text goes out between 21:00 and 08:00: 37 texts, all between 08:00 and 21:00
PASS  Quiet hours calls are texted at 08:00: 6 queued calls texted at 08:00
PASS  Nobody is texted after opting out: 4 opt outs, 0 texts after them
PASS  Every reply gets the right action: 11 replies stored once each
PASS  Link taps redirect, preview bots are ignored: 17 taps, bot got 403
PASS  Report numbers match the hand count: 21 numbers match
PASS  Report carries no phone numbers: counts only
PASS  Manager alerts and the report reach Slack and email: 5 Slack posts, 5 emails
PASS  Webhooks refuse callers without the login (Twilio retries with it after the challenge): no login: 401 with "Basic realm="Webhook"", wrong password: 401
PASS  n8n and the in-process demo produce the same report: report text is identical
PASS  n8n and the in-process demo agree on every call outcome: 41 outcomes identical
```

The answer key in [scenarios/harbour-slice-day.ts](scenarios/harbour-slice-day.ts) is written by hand, so the tests check the kit against an independent count, not against itself. The e2e run needs a test clock to replay a whole day. It is switched on only in `config/e2e.json`; the shipped workflows ignore the header, and a test checks that.

## POPIA notes

This is not legal advice. It is how the kit is built, so you can check it against your own advice.

- **Consent and purpose.** The customer phoned you. The kit sends one reply about that call, with a way to book. It does not add anyone to a marketing list. If you put promotions in the text, it becomes direct marketing, and POPIA section 69 sets stricter rules for that. Mention the text back in your privacy notice.
- **Opt out.** Every text says "Reply STOP to opt out". STOP, UNSUBSCRIBE and OPT OUT count anywhere in a reply. The number goes on a permanent opt out list, checked before every send: live texts, texts released at 08:00 and YES replies. No confirmation text is sent. Only remove a number by hand, at that person's request.
- **Quiet hours.** No texts from 21:00 to 08:00 Africa/Johannesburg. Calls in that window wait until 08:00, and anything older than 16 hours is dropped. Both are in the Config node. If your texts carry promotions, check the Consumer Protection Act rules on contact times, which can be stricter.
- **Data kept.** In your Postgres only:

  | Table | What is stored | Kept for |
  |---|---|---|
  | `hs_missed_calls` | Caller number (E.164), call SID, status, times, outcome, tracking token, first tap time, Twilio error if any | 90 days, then deleted by workflow 3 |
  | `hs_sms_replies` | Message SID, number, intent (opt out, book, other), action taken. **Not the message text** | 90 days |
  | `hs_opt_outs` | Number and time of opt out | Kept, so the person is never texted again |

  The daily report has counts only. Manager alerts carry the number (and, for replies, the message) because the manager needs them, so Slack and your email provider process that data. List them as operators.
- **n8n's own log.** The workflows do not save successful executions, so n8n keeps no copy of numbers or replies for normal runs. Failed executions are kept for debugging and can contain them. Set n8n's execution pruning (`EXECUTIONS_DATA_MAX_AGE`) to match your retention.

## Stack

- n8n 2.44.5 (tested). The nodes use versions that also exist in n8n 1.x, but 1.x has not been tested.
- Postgres 17 (PGlite in tests), Twilio Programmable Voice status callbacks and the Messages API, Slack Web API `chat.postMessage`, SMTP.
- TypeScript 6 (strict) with Luxon, Vitest 5, ESLint 10, Docker Compose. npm only.
- Mocks: a small Node server for Twilio, Slack and SMTP, built on Node built-ins only.

## What I would do next

- Check Twilio's `X-Twilio-Signature` header as a second lock on the webhooks.
- Add an n8n Error Workflow so a crash outside the handled paths also alerts the manager.
- Let a customer text START to opt back in, with a confirmation.
- Run the e2e on n8n 1.x in CI.
- A small dashboard over the three tables, for owners who do not use Slack.

I also build a paid setup on top of this: WhatsApp, English and Afrikaans messages, CRM logging and booking system links, installed for you.

## License

MIT. See [LICENSE](LICENSE).
