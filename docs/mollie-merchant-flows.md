# Mollie Merchant — Lifecycle & Flow Map

A high-level conceptual map of what a "merchant" *does* inside a Mollie-style
PSP dashboard, used as scoping input for a browser-automation agent
(Gherkin scenarios → Playwright steps → fine-tuned Gemma worker).

The goal of this document is **not** to enumerate every screen. It is to make
the lifecycle legible enough that we can pick **one flow** to automate first,
and know what we are *not* doing yet.

---

## Lifecycle stages

A merchant moves through these stages, roughly in order. Stages 4–6 are
recurring; the rest are mostly one-shot.

| # | Stage              | What happens                                                                 | One-shot or recurring |
|---|--------------------|------------------------------------------------------------------------------|-----------------------|
| 1 | Sign-up            | Email + password, organisation created, country/legal-form chosen.           | One-shot              |
| 2 | Onboarding (KYB)   | Identity, business, UBO and bank verification; documents uploaded.           | One-shot (+ refresh)  |
| 3 | Activation         | Website profile, payment methods enabled, API keys / webhooks created.       | One-shot per profile  |
| 4 | Integration        | Connect storefront (Shopify / Woo / Magento) or wire direct API + webhooks.  | One-shot per channel  |
| 5 | Live operations    | Payments, refunds, chargebacks, settlements, reporting.                      | Recurring (daily)     |
| 6 | Account management | Users/roles, billing tier, security (2FA, IP allow-list), notifications.     | Recurring (rare)      |
| 7 | Risk & compliance  | KYC refresh, sanctions hits, fraud-rule tuning, 3DS exemptions.              | Recurring (event)     |
| 8 | Offboarding        | Pause profile, close organisation, export data.                              | One-shot              |

---

## Main flows per stage

### 1. Sign-up
- Create account (email, password, 2FA bootstrap).
- Choose country + legal entity type.
- Accept ToS / DPA.

### 2. Onboarding (KYB)
- Submit company details (Chamber of Commerce nr., VAT, address).
- Submit signatory + UBO identity (ID upload, selfie / video).
- Link & verify settlement bank account (micro-deposit or open-banking).
- Wait state: "review pending" → "approved" / "more info needed".

### 3. Activation
- Create a **website profile** (one per storefront / brand).
- Request payment methods (iDEAL, Bancontact, cards, PayPal, Klarna, SEPA…).
  Each is its own approval flow with its own "pending" state.
- Generate **live** API key (test key exists from day 1).
- Configure webhook URL(s).

### 4. Integration
- Install official plugin in Shopify / WooCommerce / Magento / PrestaShop.
- *Or* paste API key into a custom backend and verify a test payment.
- Trigger a test transaction; confirm it reaches the dashboard.

### 5. Live operations *(the daily-driver surface)*
- **Payments**: list, filter, search, inspect a single payment.
- **Refunds**: full / partial; reason codes.
- **Chargebacks / disputes**: respond with evidence, track status.
- **Settlements**: see balance, upcoming payout, settlement breakdown, invoice PDFs.
- **Subscriptions / recurring**: customer mandates, schedules, failures.
- **Reporting**: revenue, method mix, success rate, exports (CSV).

### 6. Account management
- Invite teammates; assign roles (Admin / Developer / Viewer / Finance).
- Rotate API keys; revoke webhooks.
- Enforce 2FA; configure SSO; IP allow-list.
- Update billing details, view pricing tier, download Mollie invoices.

### 7. Risk & compliance
- Respond to KYC refresh request (re-upload documents).
- Resolve a sanctions / PEP match on a customer.
- Tune fraud rules (3DS thresholds, blocked countries, BIN allow/deny).

### 8. Offboarding
- Disable a website profile.
- Close the organisation; final settlement.
- GDPR data export / deletion request.

---

## Pick-one heuristics for the first automation target

When choosing the first flow to wire end-to-end (Gherkin → Playwright →
Gemma-driven planner), prefer flows that score well on all four axes:

| Axis             | Good                                              | Bad                                                 |
|------------------|---------------------------------------------------|-----------------------------------------------------|
| **Reversibility**| Test-mode actions; nothing real moves.            | Real payouts, real KYC submissions, real refunds.   |
| **Determinism**  | Same input → same screens, no human review wait.  | Async review queues, days-long approval states.     |
| **Observability**| Outcome visible in UI within seconds.             | Outcome arrives by email / webhook hours later.     |
| **Surface size** | 1–5 screens, ≤ 20 distinct UI actions.            | 30+ screens, modal-heavy, conditional sub-flows.    |

### Recommendation: start with **a test-mode payment lifecycle**

Specifically: *create a test payment → view it in the dashboard → issue a
partial refund → verify final state*.

Why this one first:
- **Test-mode is free, reversible, and idempotent** — no KYC, no real money.
- It exercises the **core merchant verb**: a payment. Everything else in
  Mollie ultimately decorates this object.
- The full loop fits in ~4 screens and ~10 actions — small enough that the
  Gherkin file is readable, large enough that the agent must handle search,
  filters, detail navigation, and a destructive action (refund) under
  confirmation.
- The outcome is observable in the UI within one page-refresh, so the
  Playwright assertions are straightforward.

### Explicit non-goals for the first iteration
- KYB / onboarding (human review in the loop).
- Live-mode payments (real money + real risk rules).
- Settlements & invoicing (data is read-only and depends on a real history).
- Plugin install flows in third-party storefronts (out of Mollie's domain).

---

## How this maps to the agent architecture

For each leaf flow above, the eventual artefact set is:

```
features/<flow>.feature        # Gherkin: high-level, human-authored
  └── steps/<flow>.steps.ts    # Playwright step definitions
        └── planner            # Gemma-fine-tuned model picks selectors / next click
              └── executor     # actual page.* calls, screenshots, traces
```

The Gherkin file is the **contract**. The planner's job is to translate one
Gherkin step ("Given I am viewing the payment <id>") into one or more
deterministic Playwright actions. The executor is dumb on purpose.

Open questions to resolve before writing the first `.feature`:
- Sandbox account: do we have a long-lived Mollie test organisation, or
  does each CI run create a fresh one? (Strongly prefer long-lived.)
- Auth: cookie-replay vs. real login each run. Real login means 2FA — pick
  a no-2FA test account or use a TOTP secret in CI.
- Locale: Mollie's UI is i18n'd. Pin to one locale (en-GB) in the test
  fixture to keep selectors stable.
