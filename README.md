# Brightloop Software Subscription Management

A comprehensive, production-grade Subscription Management and Billing application built for **Brightloop Software**. The system provides tailored role-based portals for **Administrators**, **Staff**, and **Customers**, streamlining the entire lifecycle of software subscriptions, automated recurring billing, quotation workflows, tax and discount configurations, payment recording, expiry notifications, and financial reporting.

---

## 🎨 Visual Design & Aesthetics

The application features a modern, Google Search Console-inspired user interface built with:
- **Typography:** *Plus Jakarta Sans* for headers and branding; *Figtree* for crisp action buttons and form controls; *Material Symbols Outlined* for intuitive iconography.
- **Color Palette:** Clean white and soft gray background surfaces, dark headers, and vibrant green (`#25D366`) and blue primary action buttons.
- **Components:** Responsive collapsible sidebar, floating top navigation with notification badge, interactive modal dialogs, status badges, and mobile-friendly overlays.

---

## 🚀 Quick Start

### Prerequisites
- **Node.js**: Version 24.0.0 or higher.
- **npm** or **pnpm**.

### Installation & Launch

```sh
# Install dependencies
npm install

# Start the application server
npm start
```

Open **`http://localhost:3000`** in your browser.

> [!NOTE]
> The application must be served through the Node.js server. Opening `index.html` directly will not provide storage or authentication.

### Default Bootstrap Accounts

When initialized on a fresh database, default credentials are:
- **Administrator:** `make_a_ton@gmail.com` / `makeaton123` *(configurable via `.env`)*
- **Public Sign-Up:** Any user who registers via the web interface is automatically provisioned with a secure **Customer** account.
- **Staff Accounts:** Created and managed exclusively by Administrators from the **Team access** dashboard.

---

## 📋 Comprehensive Feature Overview

### 1. User Authentication & Security
- **Multi-Role Access Control:** Separate portals and permissions for `admin`, `staff`, and `customer`.
- **Registration & Validation:** Customer registration with strict password policies (more than 8 characters, at least one uppercase letter, one lowercase letter, and one special character).
- **Secure Password Hashing:** Salted `scrypt` password hashing and secure HttpOnly cookie session management.
- **Forgot Password & Recovery:** Automated reset links and 6-digit recovery verification codes with rate limiting and 30-minute expiry.
- **Session Security:** Resetting a password immediately invalidates all active sessions. Instant session termination upon account deactivation.

### 2. Role-Based Portals (RBAC)
- **Admin Control Center:**
  - Complete control over product catalog, billing plans, customer records, taxes, and discounts.
  - Team management: Create staff members, assign initial passwords, reset passwords, and toggle active/deactivated statuses.
  - Linking unlinked customer billing records to registered customer accounts.
  - Audit trail viewer tracking workspace activity and events.
  - High-level business overview with total revenue, MRR, overdue balances, and customer counts.
- **Staff Workspace:**
  - Daily operations center with customer task management and customer detail editing.
  - Quotation and quotation template creation and management.
  - Subscription lifecycle management (confirm, activate, pause, resume, close, renew).
  - Draft invoice review, invoice confirmation, email dispatch, and payment recording.
  - Filtered Excel spreadsheet report builder.
- **Customer Portal:**
  - Self-service store to explore software products, features, and plans.
  - Instant **Pay Now** checkout for immediate subscription activation without staff approval.
  - View personal active subscriptions, cycle pricing, and next billing dates.
  - Manage and attach add-ons to active subscriptions.
  - View invoices, check payment history, and print or download invoices as PDF.
  - Strict data isolation: Customers can never access another customer's data or administrative settings.

### 3. Product & Variant Management
- Categorized products: **Software**, **Service**, and **Add-on**.
- Detailed product metadata: Name, sales price, optional cost price, description, feature lists, and notes.
- **Brand & Product Variants:** Support for custom variants with independent price adjustments (demonstrated with Accounting Software: *Basic* brand at ₹500/mo and *Odoo* brand at ₹1,060/mo).
- Variant multiplier support for annual plans.

### 4. Billing Plans & Flexible Frequency
- **Billing Cycles:** Full support for `Daily`, `Weekly`, `Monthly`, and `Yearly` cycles.
- **Quantity Constraints:** Configurable minimum quantities per plan.
- **Availability Windows:** Optional start (`starts`) and end (`ends`) availability dates.
- **Plan Permissions:** Granular administrative flags controlling whether customers are permitted to pause (`allowPause`), close early (`allowClose`), or renew (`allowRenew`).
- **Auto-Close:** Automated contract closing when reaching plan end dates (`autoClose`).

### 5. Quotation Engine & Reusable Templates
- **Quotation Templates:** Predefined multi-line product templates with preset validity periods (in days) and terms.
- **Draft Quotations:** Custom quotation builder supporting up to 25 product lines, custom quantities, taxes, and discounts.
- **Unique Quotation Numbers:** Formatted reference numbers (e.g., `QUO-XXXXXXXX`).
- **One-Click Subscription Conversion:** Confirmed quotations convert directly into active subscriptions with full line snapshots.

### 6. Subscription Lifecycle Management
- **State Machine:** Validated transitions between `Draft`, `Quotation`, `Confirmed`, `Active`, `Paused`, and `Closed`.
- **Unique Subscription IDs:** Auto-generated references (e.g., `SUB-XXXXXXXX`).
- **Pause & Resume Logic:** Pausing subscriptions skips billing for paused periods; resuming recalculates the next billing date cleanly.
- **Customer Add-on Management:** Attach or remove add-ons to active subscriptions; changes are applied to future billing cycles without altering past invoices.
- **Contract Renewals:** Renewal action provisions a fresh subscription contract cleanly linked to historical records.

### 7. Instant Demo Checkout (Pay Now)
- **No Staff Approval Needed:** Customers can purchase plans with the **"Pay Now & Subscribe"** button.
- **Automatic Instant Activation:** Immediately marks the subscription as `Active`, sets terms to `'Demo Instant Payment'`, advances the next billing date to the next cycle, generates a `Paid` invoice, and records a demo payment.
- **On-Demand Draft Payment:** Any pending draft subscription can also be activated instantly using the "Pay Now" action in the customer subscriptions table.

### 8. Automated Billing Engine & Invoicing
- **Batch Recurring Billing:** Background automation runs every minute while the server is active, automatically generating invoices for active subscriptions whose next billing date is due.
- **Manual Billing:** Staff and administrators can trigger batch billing on-demand via the **Run billing** button.
- **Duplicate Prevention:** Strict idempotency guarantees each billing period is billed exactly once.
- **Line Snapshots:** Invoices capture an immutable snapshot of product lines, quantities, unit prices, discounts, and taxes.
- **Invoice Lifecycle:** `Draft` review → `Confirmed` (issued receivable) → `Paid` or `Cancelled`.
- **Printable Invoices:** Clean, professional invoice document ready for printing or saving to PDF.

### 9. Tax & Advanced Discount Engines
- **Tax Rules:** Configurable tax rates (e.g., GST 18%, GST 12%, GST 5%, Zero-tax) automatically applied to invoice line items.
- **Discount Rules:**
  - Types: Fixed amount (e.g., ₹100 Off) or Percentage (e.g., 10% Off).
  - Eligibility constraints: Minimum quantity, minimum purchase amount, start date, and end date.
  - Usage Limits: Maximum usage caps (`limit`) with real-time redemption tracking (`used`).
  - Scopes: Applies either to a specific product or across the entire subscription.
  - Automatic expiration: Expired or maxed-out discounts stop applying automatically.

### 10. Payment Recording & Overdue Tracking
- Staff and admin payment recording against confirmed unpaid invoices.
- Supported payment methods: `Card`, `Bank transfer`, `Cash`, and `Other`.
- Automatic invoice settlement: Status transitions to `Paid` once the balance reaches zero.
- Overpayment prevention: Disallows recording payment amounts greater than the remaining balance.
- Overdue tracking: Identifies and highlights overdue invoices past their due dates.

### 11. Automated 3-Stage Plan Expiry Email Alerts
- Background automation checks for upcoming and expired subscriptions daily:
  1. **Stage 1 (1 Week Before):** Advance notice sent 7 days prior to plan expiry.
  2. **Stage 2 (1 Day Before):** Urgent reminder sent 24 hours prior to plan expiry.
  3. **Stage 3 (On Expiry Date):** Final expiration notice sent on the expiry day.
- **Rich Email Content:** Includes customer name, subscription reference, product name, expiry date, and a complete catalog of all available renewal plans and pricing for that product.
- **Reliability:** Built-in delivery deduplication and retry queue for failed email attempts.

### 12. In-App Notification Center
- Top navigation notification bell with real-time unread badge counter.
- Interactive popover displaying chronological system notices.
- Notifications triggered for:
  - Quotation creation and conversion.
  - Invoices due and overdue alerts.
  - Plan expiration notices (1 week, 1 day, on-expiry).
  - Payment confirmations.
- Options to mark individual notices as read or "Mark all read".

### 13. Excel Spreadsheet Report Builder (.XLSX)
- Configurable spreadsheet generator built on **ExcelJS**.
- Selectable datasets: `Subscriptions`, `Renewals`, `Invoices`, `Payments`, and `Customers`.
- Flexible customization: Choose specific columns, date ranges, status filters, and currency filters.
- Professional formatting: Frozen header rows, auto-filter dropdowns, bold headers, formatted currency values, and ISO date cells.
- Invoices CSV export option also available.

### 14. Dashboards & Financial Analytics
- **Live Business Metrics:** Monthly Recurring Revenue (MRR), total collections, outstanding balances, and active subscriptions.
- **Revenue Trend Chart:** Interactive SVG chart displaying collections vs. invoiced revenue across 30-day, 90-day, or 1-year windows.
- **Multi-Currency Support:** Separate accounting and reporting for INR and USD.
- **Audit Logging:** System logs every record creation, update, deletion, quotation conversion, and export.

---

## 🛠️ Testing & Verification

The project includes 11 end-to-end automated test suites covering all critical paths:

```sh
# Run the complete test suite
npm test
```

### Verified Test Suites:
1. `tests/admin-portal.test.js`: Admin login, RBAC, customer management, catalog CRUD, audit logging.
2. `tests/challenge-requirements.test.js`: Core challenge workflows, templates, lifecycle, billing.
3. `tests/excel-report.test.js`: Excel spreadsheet creation, column selection, date/status filtering, RBAC restrictions.
4. `tests/expiry-email.test.js`: 3-stage plan expiry emails (1 week, 1 day, expiry day), plan details inclusion, idempotency.
5. `tests/final-integration.test.js`: Scale testing (3,000 subscriptions billed < 2s), task assignments, profile linking.
6. `tests/integration.test.js`: Accounts, authorization, recurring billing, discounts, taxes, payment validation.
7. `tests/merged-mail.test.js`: Email delivery boundaries, failure retry queue, escaping, quotation ownership.
8. `tests/pay-now.test.js`: Customer instant checkout, active subscription status, automatic paid invoice and payment record.
9. `tests/portal-alignment.test.js`: Cross-portal alignment between admin, staff, and customer views.
10. `tests/software-portal.test.js`: Software catalog, variants (Basic vs. Odoo), plan permissions, owned subscriptions.
11. `tests/staff-security.test.js`: Staff access boundaries, customer assignment isolation, password changes.

---

## ⚙️ Environment Configuration

To configure outbound SMTP emails and deployment settings, create a `.env` file in the project root:

```env
PORT=3000
DATA_DIR=data
BOOTSTRAP_ADMIN_EMAIL=make_a_ton@gmail.com
BOOTSTRAP_ADMIN_PASSWORD=makeaton123

# Outbound SMTP Email Settings
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=password
MAIL_FROM="Brightloop Software <no-reply@brightloop.com>"
APP_URL=http://localhost:3000

# Local Testing (prints reset & recovery links to console if SMTP is not configured)
DEV_RESET_LINKS=true
```

---

## 📁 Repository Structure

```
├── app.js                   # Main application frontend (Admin, Staff, Navigation, Dialogs)
├── customer-portal.js       # Dedicated Customer self-service portal
├── server.js                # Core HTTP server, REST API, SQLite database, and billing scheduler
├── software-server.js       # Customer portal API endpoints and instant Pay Now demo checkout
├── software-catalog.js      # Default software products, plans, and brand variants
├── excel-report.js          # ExcelJS spreadsheet generation and dataset schemas
├── expiry-mail.js           # Automated 3-stage plan expiry email engine
├── index.html               # Main HTML entry point
├── styles.css               # Core CSS layout and responsive components
├── theme.css                # Visual theme tokens, typography, badges, and cards
├── scripts/
│   └── seed-software-demo.js# Demo database seeder (products, plans, and demo subscriptions)
└── tests/                   # 11 automated test suites
```

---

## 📄 License

This project is licensed under the MIT License.
