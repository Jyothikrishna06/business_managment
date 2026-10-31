# Brightloop Software Subscription Management

The shared visual theme in `theme.css` is inspired by [Mixroutes](https://www.mixroutes.com/): white backgrounds, black headings, Plus Jakarta Sans typography, Figtree action labels, green `#25D366` primary actions, soft gray surfaces and rounded cards. It applies to sign-in and all three portals, with responsive layouts and visible keyboard focus. The underlying portal workflows are unchanged by this theme layer.

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

This is a working local MVP. Payments are recorded manually; no payment processor charges cards. Customers can request draft subscriptions, print their own invoices, view recorded payments and use administrator-permitted pause, resume, close and renewal actions. Software product variants have names and price adjustments; Accounting Software demonstrates Basic and Odoo brands. Contracts currently have a single product line. Advanced quotation templates, prorations, payment retries, customer plan changes, email verification, recurring reminder emails and multi-tenant workspaces are future work. Availability filters and the chart use UTC billing dates. Large datasets are loaded into memory; pagination and performance work are needed before claiming the PDF's two-second target at scale.

The server binds to loopback. Before hosting, configure HTTPS, secure cookies and SMTP, and replace first-registration administrator setup with an explicit deployment bootstrap. Back up SQLite data and use a supervised scheduler if the app must bill while its UI is closed or its process restarts. Fonts load from Google Fonts with Arial fallback.

## Brightloop software customer portal

This customer branch demonstrates the Subscription Management System problem statement using fictional software and services. It replaces the device, health-reading and physical-band experience with a Google-inspired customer overview, product catalog, subscriptions, invoices, payments and account pages. Legacy image assets remain in repository history/files but are not used by the software portal.

A product is the software or service sold. It has a name, product type, sales price, optional cost price, notes and brand variants. A billing plan links to that product and sets its cycle, price, minimum quantity, availability and permitted customer actions. A subscription is the authenticated customer's saved purchase record, including the selected variant and a snapshot of its price. Customer selections create Draft subscriptions for team confirmation; they do not charge a payment method. Customers cannot change prices, attach another customer's ID, create staff, modify catalog rules or access other customers' subscriptions/invoices/payments.

The sample INR products are Cloud Storage ₹499, CRM Software ₹999, Antivirus ₹299, Project Management Tool ₹799, Email Hosting ₹399 and Accounting Software ₹500. Accounting's Basic brand adds ₹0 and Odoo adds ₹560, giving ₹1,060/month. Yearly demo plans bill twelve monthly base/variant amounts; no annual discount is invented. Costs are left unset because none were supplied. Admin product forms support adding/removing variants and their extra prices; plan forms control pause, closure and renewal.

Start the server once to initialize an isolated demo database, then set `DATA_DIR` to that database directory and run `node scripts/seed-software-demo.js`. This repeatable setup adds six products, twelve plans and twenty fictional customer records with software subscriptions. It does not create sign-in accounts or payments, overwrite existing records, or reassign real customers. Public sign-up creates a private customer account; admins must explicitly link any pre-existing matching customer record after verifying ownership.

Invoices retain each subscription's currency; records with no currency remain legacy USD. Reports filter INR and USD separately instead of adding incompatible currencies, and exports include a currency column. Password registration/reset/staff-creation validation follows the PDF: more than eight characters, uppercase, lowercase and a special character. Existing account sign-in, cookie sessions and recovery flow are retained.

Run `npm test`, or run `node tests/integration.test.js` and `node tests/software-portal.test.js` directly if process-isolated tests are blocked. Tests cover authentication/recovery, billing idempotency, payment accounting, INR/legacy currency behavior, the Basic/Odoo example, server-calculated pricing, customer ownership and plan-controlled actions. Demo performance tests do not establish the problem statement's two-second target at thousands-of-record scale.
