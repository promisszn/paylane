# Paylane

**An AI payments agent for freelancers. Paste what a client sent you, and Paylane turns it into PayPal invoices, sends them when you say so, and chases late payments in the right tone.**

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) on the PayPal sandbox.

> Demo video: _add YouTube link_
>
> Live demo: _add URL_

---

## The problem

Freelancers lose real money to admin. A deal gets agreed in a chat ("$800, half upfront, rest when it's live"), and then someone has to:

- turn that sentence into invoices with the right amounts and due dates
- remember to bill the next milestone when the work is done
- notice when a payment is late and write a reminder that is firm without souring the relationship

Most freelancers do this from memory and a spreadsheet. Invoices go out late, milestones get forgotten, and awkward follow-ups get put off for weeks.

## What Paylane does

1. **Reads the deal.** Paste a client message. The agent extracts the client, total, currency and a milestone plan (deposit, phases, final payment), and flags anything it couldn't work out, like a missing email.
2. **You approve the plan.** It shows up as an editable receipt. Change any name, amount or due date before saving.
3. **Drafts the invoices.** For upfront milestones, Paylane creates a **PayPal draft invoice** and the agent writes the email that goes with it.
4. **You press Send.** Nothing reaches the client until you review the email and approve it. PayPal emails the invoice with a pay button.
5. **Tracks every payment.** A receivables ledger (AG Grid) shows every milestone across every job: drafted, sent, overdue or paid.
6. **Suggests the next move.** When a deposit is paid, the agent offers to bill the next milestone. When an invoice is overdue, it writes a reminder whose tone matches how late it is and how many nudges have gone out.

### The human stays in charge of the money

The agent prepares. You decide. This is enforced in code, not just in the UI:

| The agent can | Only you can |
| --- | --- |
| Read a message and propose a plan | Save the plan |
| Create a PayPal **draft** (invisible to the client) | **Send** an invoice |
| Write invoice and reminder emails | **Send** a reminder |
| Suggest what to do next | Cancel an invoice |

The routes that email a client (`send`, `remind`, `cancel`) live in [`server/api/milestones/[action].post.ts`](server/api/milestones/[action].post.ts) and are only called from the review dialog after you click. Every action is written to an activity log tagged **Agent**, **You** or **PayPal**.

---

## How PayPal is used

All calls go to the PayPal REST APIs in [`server/utils/paypal.ts`](server/utils/paypal.ts):

| PayPal API | Used for |
| --- | --- |
| `POST /v1/oauth2/token` | Client-credentials auth, token cached until expiry |
| `POST /v2/invoicing/generate-next-invoice-number` | Sequential invoice numbers |
| `POST /v2/invoicing/invoices` | Create a draft invoice per milestone (line item, due date, client, note) |
| `POST /v2/invoicing/invoices/{id}/send` | Email the invoice after you approve |
| `POST /v2/invoicing/invoices/{id}/remind` | Send the agent's reminder after you approve |
| `POST /v2/invoicing/invoices/{id}/cancel` | Cancel a sent invoice |
| `GET /v2/invoicing/invoices/{id}` | Read status and the client's pay link |
| `POST /v1/notifications/verify-webhook-signature` | Verify every incoming webhook before trusting it |
| Webhook `INVOICING.INVOICE.PAID` | Mark a milestone paid the moment the client pays |

## How AI is used

The agent lives in [`server/utils/ai.ts`](server/utils/ai.ts). It uses the [Vercel AI SDK](https://ai-sdk.dev) with **Claude** (default) or **OpenAI**, and every call returns structured output validated by a Zod schema, so the app never parses free text.

| Job | Input | Output |
| --- | --- | --- |
| Plan the deal | Raw client message | Client, currency, total, milestones, open questions |
| Write the invoice email | Project and milestone | Subject and a short, human note |
| Write a reminder | Days overdue, reminders already sent | Subject and note, tone scaled from friendly to firm |

What to suggest next is decided by plain rules in [`server/utils/billing.ts`](server/utils/billing.ts) (draft waiting, invoice 1+ days overdue with no nudge in 3 days, previous milestones all paid). The model only writes the words, so the suggestions stay predictable.

Guardrails in code: milestone amounts are re-balanced so they always add up to the agreed total, the model is told never to invent an email address, and missing details come back as questions instead of guesses.

---

## Run it yourself

You need **Node 20+**, **npm**, a free **PayPal Developer** account and an **Anthropic** (or OpenAI) API key. Setup takes about 5 minutes.

### 1. Get PayPal sandbox credentials

1. Sign in at [developer.paypal.com](https://developer.paypal.com/dashboard/) and make sure the toggle says **Sandbox**.
2. Go to **Apps & Credentials → Create App**, type **Merchant**, keep the default sandbox business account.
3. Copy the **Client ID** and **Secret**.
4. Go to **Testing Tools → Sandbox Accounts** and note the **personal** account's email and password. That account plays your client and pays your invoices.

### 2. Install and configure

```bash
git clone https://github.com/promisszn/paylane.git
cd paylane
npm install
cp .env.example .env
```

Fill in `.env`:

```bash
PAYPAL_CLIENT_ID=...        # from step 1
PAYPAL_CLIENT_SECRET=...
ANTHROPIC_API_KEY=...       # or AI_PROVIDER=openai + OPENAI_API_KEY, or AI_PROVIDER=google + GOOGLE_GENERATIVE_AI_API_KEY
FREELANCER_NAME=Your Name   # appears on invoices
FREELANCER_BUSINESS=Your Studio
```

### 3. Start it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). If a key is missing, the page tells you which one.

### 4. Try the full loop

1. Click **Landing page, half upfront** under _Try an example_, then **Plan payments**.
2. Change the client email to your sandbox **personal** account email, then **Approve plan**.
3. Under **Agent suggests**, click **Review and send**, read the email, and press **Send invoice**.
4. In the ledger, click **Pay link** on that row, sign in as the sandbox personal account, and pay.
5. Back in Paylane, click **Check for payments**. The deposit flips to **Paid** and the agent offers to bill the final milestone.

### See the reminder flow without waiting

Payment reminders only matter once an invoice is late. To show them right away, set `DEMO_MODE=true` in `.env` (it only works with `PAYPAL_ENV=sandbox`) and restart.

1. Send an invoice, and don't pay it.
2. In the ledger, click **Make overdue** on that row. Each click moves it further: 2 days, then 10, then 20.
3. Click **Remind**. The agent's reminder gets firmer as the invoice gets later: a friendly nudge at 2 days, a clear restatement of the amount at 10, and a calm request for a payment date at 20.

Demo mode only changes Paylane's local copy of the due date. PayPal keeps the real one, and every change is written to the activity log.

### Webhooks (optional)

Locally, **Check for payments** pulls status from PayPal, so you don't need a public URL. On a deployed instance:

1. In your sandbox app, add a webhook to `https://<your-domain>/api/webhooks/paypal`.
2. Subscribe to `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.CANCELLED` and `INVOICING.INVOICE.UPDATED`.
3. Put the webhook ID in `PAYPAL_WEBHOOK_ID`.

Payments then show up on their own. Every event is verified with PayPal before it's used.

---

## Project structure

```
server/
  api/
    agent/plan.post.ts          agent proposes a plan (nothing saved)
    projects/index.post.ts      you approve, drafts are created
    milestones/[action].post.ts draft, send, complete, reminder-draft, remind, cancel
    dashboard.get.ts            stats, ledger rows, suggestions, activity
    sync.post.ts                pull invoice status from PayPal
    webhooks/paypal.post.ts     verified PayPal webhooks
  utils/
    paypal.ts                   PayPal REST client
    ai.ts                       the agent: plan, invoice email, reminder
    billing.ts                  approval flow, suggestion rules, ledger rows
    store.ts                    JSON storage in .data/
components/
  JobIntake.vue                 paste a client message
  PlanReceipt.vue               editable plan, approve
  NextActions.vue               agent suggestions
  ReceivablesGrid.client.vue    AG Grid ledger
  EmailReview.vue               the review-and-send checkpoint
  ActivityLog.vue, StatusLine.vue, ToastStack.vue, SetupNotice.vue
types/index.ts                  shared types
```

## Tools used

- **PayPal Invoicing v2 and Webhooks APIs** (sandbox)
- **Claude** via the Vercel AI SDK (`@ai-sdk/anthropic`), with OpenAI as an option
- **AG Grid Community** for the receivables ledger
- **Nuxt 3**, Vue 3, TypeScript, Zod

Data is stored as JSON in `.data/` so the project runs with no database.

## License

[MIT](LICENSE)
