# Subscript Console

A local subscription-management application with a Google Search Console inspired interface, Roboto typography, Material Symbols, rounded navigation selection and pill filters.

## Run

Requires Node.js 24 or newer.

```sh
npm install
npm start
```

If using pnpm, use `pnpm install` and `pnpm start` instead. Open http://localhost:3000. Serve through the Node server; opening `index.html` directly does not provide authentication or storage.

The application has three separate role experiences: administrator, staff and customer. On a new database, the bootstrap administrator is `make_a_ton@gmail.com` with password `makeaton123` unless overridden through `.env` before the first start. Public registration always creates a customer account. Administrators create staff accounts and assign their initial passwords from Team access. This is one shared workspace, not a multi-tenant service.

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

1. Sign in as the bootstrap administrator, or change its credentials in `.env` before starting the server.
2. Create a product, billing plan, customer, and optionally a tax/discount rule.
3. Create a subscription and activate it, or create and convert a quotation first.
4. Open Invoices and choose Run billing. A background job also runs every minute while the server is running.
5. Record payments against invoices. Dashboard totals update from saved records.
6. Customer registrations open the customer portal. To connect an existing billing record, verify the account owner and save that customer record again using the registered email. Public registration alone never grants access to preexisting contracts.

## Validation

```sh
npm test
```

Integration tests exercise authentication, authorization, billing idempotency, tax/discount calculations, partial/full payment accounting, overpayment rejection and password recovery/session invalidation.

## Current scope

This is a working local MVP. Payments are recorded manually; no payment processor charges cards. Customer portals currently provide read access and invoice printing. Product variants are represented as separate products/notes. The legacy admin contract editor has one product line; staff health-band sales support multiple one-time and recurring lines. Prorations, payment retries, customer plan changes, email verification, scheduled reminder emails and multi-tenant workspaces are future work. Availability filters and the chart use UTC billing dates. Large datasets are loaded into memory; pagination and performance work are needed before claiming the PDF's two-second target at scale.

The server binds to loopback. Before hosting, configure HTTPS, secure cookies and SMTP, and replace first-registration administrator setup with an explicit deployment bootstrap. Back up SQLite data and use a supervised scheduler if the app must bill while its UI is closed or its process restarts. Fonts load from Google Fonts with Arial fallback.

## Staff portal

Administrators create staff from Team access, assign customers from Customers → Edit → Assigned staff, and assign dated tasks from Team access → Assign staff work. Existing customers are unassigned by default. Staff see only assigned customer records, subscription status and related sales and billing records. Staff can edit names, companies, phone numbers and notes; account email, portal links, assignments and catalog administration remain administrator-controlled. Staff sales and billing actions are restricted to assigned customers through dedicated routes.

The staff dashboard shows assigned work, service counts and today’s activity in the browser’s local date. Staff can track task progress, log internal support requests, service follow-ups and contact notes, resolve service entries, edit their profile and change their password using their current password. Password changes invalidate other sessions and reset links. Service actions are internal records and do not send email. Reassigning a customer immediately removes the previous staff member’s access to that customer, subscriptions, tasks and support records.

The existing customer portal and shared sign-in remain in place. Staff data filtering and mutation restrictions are enforced on the server, including requests made outside the UI. Minimal admin assignment controls support the staff workflow.

Run `npm test`, or run the suites directly with `node tests/integration.test.js` and `node tests/staff-security.test.js` in environments that block child-process test isolation. Tests use isolated temporary databases and close their database connections during cleanup.

## Health-band staff sales

Staff can create a health-band sale from the admin product catalog, combining one-time band/variant purchases and recurring health-monitoring service lines. A monitoring service is required and follows an approved daily, weekly, monthly or yearly plan. Staff cannot override catalog prices or create tax/discount rules. Drafts and quotations can be edited before confirmation, saved as reusable staff-owned templates, and progressed through Draft → Quotation → Confirmed → Active → Closed, with pause/resume and renewal. Quotes have an explicit validity window; closed renewals prefill only recurring lines at current catalog prices.

Billing produces draft invoices for staff sales. One-time purchases appear on the first billing date only; recurring monitoring lines repeat on the plan cycle. Taxes and eligible discounts are checked per billing date. Legacy contracts retain their confirmed-invoice behavior. Staff can generate due invoices only for assigned customers, confirm drafts individually or in bulk, cancel unpaid invoices, print all product lines, email invoices and send payment reminders. Email requires SMTP configuration; the UI reports configuration errors rather than pretending delivery succeeded.

Partial and full payments are recorded manually against confirmed invoices with a method, date and notes. Overpayments, future dates and sub-cent amounts are rejected. Cancelled billing periods are retained to prevent duplicate billing. There is no automatic card charge or live health-sensor ingestion: this workflow manages device sales and the monitoring service subscription.

Run `node tests/staff-sales.test.js` in addition to the authentication and staff-security suites. The sales suite verifies catalog pricing, assignment protection, quotation transitions, multi-line billing, one-time versus recurring charges, invoice drafts, bulk confirmation, payment accounting and reassignment revocation. Preview data is kept outside the repository and is not committed.
