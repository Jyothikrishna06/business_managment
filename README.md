# Subscript Console

A local subscription-management application with a Google Search Console inspired interface, Roboto typography, Material Symbols, rounded navigation selection and pill filters.

## Run

Requires Node.js 24 or newer.

```sh
npm install
npm start
```

If using pnpm, use `pnpm install` and `pnpm start` instead. Open http://localhost:3000. Serve through the Node server; opening `index.html` directly does not provide authentication or storage.

The first registered account is the workspace administrator. Later public registrations create customer accounts. Administrators create staff accounts from Team access. This is one shared workspace, not a multi-tenant service.

## Implemented

- Email/password registration, login, logout and persistent HttpOnly cookie sessions.
- Salted scrypt password hashes, password validation and sign-in attempt limits.
- Forgot-password email flow; hashed, single-use reset tokens valid for 30 minutes; resetting a password invalidates existing sessions.
- Profile page and role restrictions enforced by the backend.
- Create, edit and search products, plans, customers, discount rules and tax rules.
- Quotation creation and conversion to a confirmed subscription.
- Subscription activation, pause, close and renewal through a new contract.
- Recurring invoices generated from active subscriptions, once per billing period; discounts and taxes calculated automatically.
- Record partial/full payments, reject overpayments and track outstanding/overdue balances.
- Print invoices or save them as PDFs with the browser print dialog, email invoice summaries, cancel unpaid invoices.
- Actual revenue chart, dashboard summaries, overdue report, invoice CSV export and printable reports.
- SQLite persistence and audit records in `data/subscript.db`; data is excluded from Git.

## Password reset email

Copy `.env.example` to `.env` and configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM and APP_URL. Start with `npm start` to load `.env`. Password-reset and invoice emails use that SMTP service. No email is sent without SMTP configuration.

For local testing only, set `DEV_RESET_LINKS=true` in `.env`. With SMTP_HOST unset, reset links print to the server terminal rather than being delivered. The browser never receives reset tokens through the API.

## Workflow

1. Register your administrator and sign in.
2. Create a product, billing plan, customer, and optionally a tax/discount rule.
3. Create a subscription and activate it, or create and convert a quotation first.
4. Open Invoices and choose Run billing. A background job also runs every minute while the server is running.
5. Record payments against invoices. Dashboard totals update from saved records.
6. Have the customer register, then create a customer record using their email. If their billing record already existed before registration, verify the account owner and save that customer record again to explicitly link it. Public registration alone never grants access to preexisting contracts.

## Validation

```sh
npm test
```

Integration tests exercise authentication, authorization, billing idempotency, tax/discount calculations, partial/full payment accounting, overpayment rejection and password recovery/session invalidation.

## Current scope

This is a working local MVP. Payments are recorded manually; no payment processor charges cards. Customer portals currently provide read access and invoice printing. Product variants are represented as separate products/notes. Contracts currently have a single product line. Advanced quotation templates, prorations, payment retries, customer plan changes, email verification, recurring reminder emails and multi-tenant workspaces are future work. Availability filters and the chart use UTC billing dates. Large datasets are loaded into memory; pagination and performance work are needed before claiming the PDF's two-second target at scale.

The server binds to loopback. Before hosting, configure HTTPS, secure cookies and SMTP, and replace first-registration administrator setup with an explicit deployment bootstrap. Back up SQLite data and use a supervised scheduler if the app must bill while its UI is closed or its process restarts. Fonts load from Google Fonts with Arial fallback.
