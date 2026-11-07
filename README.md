# Paylane

**An AI payments agent for freelancers. Paste what a client sent you, and Paylane turns it into PayPal invoices, sends them when you say so, and chases late payments in the right tone.**

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) on the PayPal sandbox.

> Demo video: _add YouTube link_
>
> Live demo: **[paylane.onrender.com](https://paylane.onrender.com)** (PayPal sandbox. Pay invoices with any [sandbox personal account](https://developer.paypal.com/dashboard/accounts). The first load can take up to a minute if the app has been idle.)

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
| Webhook `INVOICING.INVOICE.PAID` | On a deployed instance, mark a milestone paid the moment the client pays. Locally, **Check for payments** does the same by asking PayPal (see [Webhooks](#webhooks-optional)) |

## How AI is used

The agent lives in [`server/utils/ai.ts`](server/utils/ai.ts). It uses **Google Gemini** (`gemini-flash-lite-latest` by default) through the [Vercel AI SDK](https://ai-sdk.dev), and every call returns structured output validated by a Zod schema, so the app never parses free text. Claude and OpenAI work too: set `AI_PROVIDER` to `anthropic` or `openai` and add that key.

| Job | Input | Output |
| --- | --- | --- |
| Plan the deal | Raw client message | Client, currency, total, milestones, open questions |
| Write the invoice email | Project and milestone | Subject and a short, human note |
| Write a reminder | Days overdue, reminders already sent | Subject and note, tone scaled from friendly to firm |

What to suggest next is decided by plain rules in [`server/utils/billing.ts`](server/utils/billing.ts) (draft waiting, invoice 1+ days overdue with no nudge in 3 days, previous milestones all paid). The model only writes the words, so the suggestions stay predictable.

Guardrails in code: milestone amounts are re-balanced so they always add up to the agreed total, the model is told never to invent an email address, and missing details come back as questions instead of guesses.

---

## Run it yourself

You need **Node 20+**, **npm**, a free **PayPal Developer** account and a free **Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey). Setup takes about 5 minutes.

### 1. Get PayPal sandbox credentials

1. Sign in at [developer.paypal.com](https://developer.paypal.com/dashboard/) and make sure the toggle says **Sandbox**.
2. Go to **Testing Tools → Sandbox Accounts → Create account**. Choose **Business** and **United States**. This account receives your invoice payments.
   The default sandbox business account is created in your own country, and PayPal accounts in some countries can't receive payments. Invoices then send fine but fail at payment.
3. Go to **Apps & Credentials → Create App**, type **Merchant**, and pick the US business account from step 2.
4. Open the app, scroll to **Features**, tick **Invoicing** and click **Save Changes**. Without it, creating an invoice fails.
5. Copy the app's **Client ID** and **Secret**.
6. Back in **Sandbox Accounts**, note the **personal** account's email and password. That account plays your client and pays your invoices.

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
GOOGLE_GENERATIVE_AI_API_KEY=...  # Gemini, free at aistudio.google.com/apikey
# To use Claude or OpenAI instead: AI_PROVIDER=anthropic + ANTHROPIC_API_KEY, or AI_PROVIDER=openai + OPENAI_API_KEY
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
2. In the ledger, click **Backdate** on that row. Each click moves it further: 2 days, then 10, then 20.
3. Click **Remind**. The agent's reminder gets firmer as the invoice gets later: a friendly nudge at 2 days, a clear restatement of the amount at 10, and a calm request for a payment date at 20.

Demo mode only changes Paylane's local copy of the due date. PayPal keeps the real one, and every change is written to the activity log.

**Start over.** Locally, delete the `.data/` folder. On any instance, including a deployed one, set `DEMO_RESET_TOKEN` to a long random string and run:

```bash
curl -X POST https://your-app/api/demo/reset -H "x-reset-token: YOUR_TOKEN"
```

This clears Paylane's projects and activity log. Invoices already on PayPal stay there. The reset needs `DEMO_MODE=true`, and there's no button for it, so visitors to a shared demo can't wipe it.

### Webhooks (optional)

Locally, **Check for payments** pulls status from PayPal, so you don't need a public URL. On a deployed instance:

1. In your sandbox app, add a webhook to `https://<your-domain>/api/webhooks/paypal`.
2. Subscribe to `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.CANCELLED` and `INVOICING.INVOICE.UPDATED`.
3. Put the webhook ID in `PAYPAL_WEBHOOK_ID`.

Payments then show up on their own. Every event is verified with PayPal before it's used.

### Deploy to Render

The repo includes a [Render Blueprint](render.yaml) that creates the web app and a Key Value (Redis) store for its data.

1. In [Render](https://dashboard.render.com), choose **New → Blueprint** and connect this repository.
2. Fill in the values it asks for: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `GOOGLE_GENERATIVE_AI_API_KEY`, `FREELANCER_NAME` and `FREELANCER_BUSINESS`. Leave `PAYPAL_WEBHOOK_ID` empty until you register the webhook.
3. Click **Apply**. The first build takes a few minutes.

Locally, data lives in `.data/` as JSON files. When `REDIS_URL` is set, as the Blueprint does, it lives in Redis instead, so it survives redeploys. Any Redis works, Upstash included.

Good to know: the free web service sleeps after about 15 minutes without visitors, so the first page load after that takes up to a minute. Everyone who opens the URL shares the same data, and `DEMO_MODE` is on so visitors can try **Backdate**. Render generates `DEMO_RESET_TOKEN` for you (see the service's **Environment** page) for [resetting the demo data](#see-the-reminder-flow-without-waiting). Free Key Value instances don't save to disk, so a restart of the store on Render's side also clears the data.

### Troubleshooting

| You see | Cause | Fix |
| --- | --- | --- |
| `PayPal: NOT_AUTHORIZED: Authorization failed due to insufficient permissions` when approving a plan | The app doesn't have Invoicing turned on | In the app's **Features**, tick **Invoicing** and save. Then click **Draft** on the row in the ledger. |
| The PayPal pay page shows an error, and its URL contains `code=UEFZRUVfQUNDT1VOVF9MT0NLRURfT1JfQ0xPU0VE` (`PAYEE_ACCOUNT_LOCKED_OR_CLOSED`) | The business account can't receive payments, often because of its country | Create a **US** business sandbox account, make a new app on it (step 1), and use that app's keys. |
| The page says an AI key is missing | `AI_PROVIDER` doesn't match the key you filled in | Set `AI_PROVIDER=google` with `GOOGLE_GENERATIVE_AI_API_KEY`, or switch both to Anthropic or OpenAI. |
| A change to `.env` doesn't take effect | The dev server is still using the old values | Stop `npm run dev` and start it again. |

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
    demo/overdue.post.ts        demo mode: backdate a sent invoice (sandbox only)
    demo/reset.post.ts          demo mode: clear projects and activity (needs DEMO_RESET_TOKEN)
  plugins/
    storage.ts                  JSON files in .data/ locally, Redis when REDIS_URL is set
  utils/
    paypal.ts                   PayPal REST client
    ai.ts                       the agent: plan, invoice email, reminder
    billing.ts                  approval flow, suggestion rules, ledger rows
    store.ts                    projects and activity log on top of that storage
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
- **Google Gemini** via the Vercel AI SDK (`@ai-sdk/google`), with Claude and OpenAI as options
- **AG Grid Community** for the receivables ledger
- **Nuxt 4**, Vue 3, TypeScript, Zod
- **Render** for hosting, with Render Key Value (Redis) for data

Locally, data is stored as JSON in `.data/` so the project runs with no database.

## License

[MIT](LICENSE)
