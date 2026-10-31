import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('automated 3-stage plan expiry emails: 1 week before, 1 day before, and on expiry date', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'expiry-email-test-'));
  process.env.DATA_DIR = dir;
  process.env.PORT = '0';

  const { server, sendExpiryEmail, subscriptionAutomation, db } = await import(`../server.js?test=${Date.now()}`);

  try {
    const today = new Date().toISOString().slice(0, 10);
    const datePlus = days => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };

    const customerId = 'cust-123';
    const customer = {
      id: customerId,
      name: 'Sarah Connor',
      email: 'sarah.connor@example.com',
      company: 'Cyberdyne Systems',
      userId: 'user-sarah'
    };
    db.prepare('INSERT INTO records VALUES(?,?,?)').run(customerId, 'customers', JSON.stringify(customer));

    const productId = 'prod-crm';
    const product = {
      id: productId,
      name: 'Brightloop CRM Pro',
      productType: 'Software',
      currency: 'INR',
      price: 1999
    };
    db.prepare('INSERT INTO records VALUES(?,?,?)').run(productId, 'products', JSON.stringify(product));

    const planMonthly = {
      id: 'plan-crm-monthly',
      productId,
      name: 'CRM Pro Monthly',
      cycle: 'Monthly',
      price: 1999,
      minQuantity: 1
    };
    const planAnnual = {
      id: 'plan-crm-annual',
      productId,
      name: 'CRM Pro Annual Saver',
      cycle: 'Yearly',
      price: 19990,
      minQuantity: 1
    };
    db.prepare('INSERT INTO records VALUES(?,?,?)').run(planMonthly.id, 'plans', JSON.stringify(planMonthly));
    db.prepare('INSERT INTO records VALUES(?,?,?)').run(planAnnual.id, 'plans', JSON.stringify(planAnnual));

    // Test 1: Subscription expiring in 7 days (1 week before)
    const subWeek = {
      id: 'sub-week-before',
      number: 'SUB-WEEK-001',
      customerId,
      productId,
      planId: planMonthly.id,
      quantity: 5,
      unitPrice: 1999,
      currency: 'INR',
      starts: datePlus(-23),
      ends: datePlus(7),
      cycle: 'Monthly',
      status: 'Active'
    };
    db.prepare('INSERT INTO records VALUES(?,?,?)').run(subWeek.id, 'subscriptions', JSON.stringify(subWeek));

    // Test 2: Subscription expiring in 1 day (1 day before)
    const subDay = {
      id: 'sub-day-before',
      number: 'SUB-DAY-002',
      customerId,
      productId,
      planId: planMonthly.id,
      quantity: 2,
      unitPrice: 1999,
      currency: 'INR',
      starts: datePlus(-29),
      ends: datePlus(1),
      cycle: 'Monthly',
      status: 'Active'
    };
    db.prepare('INSERT INTO records VALUES(?,?,?)').run(subDay.id, 'subscriptions', JSON.stringify(subDay));

    // Test 3: Subscription expiring today (on expiry date)
    const subToday = {
      id: 'sub-on-expiry',
      number: 'SUB-TODAY-003',
      customerId,
      productId,
      planId: planMonthly.id,
      quantity: 1,
      unitPrice: 1999,
      currency: 'INR',
      starts: datePlus(-30),
      ends: today,
      cycle: 'Monthly',
      status: 'Active'
    };
    db.prepare('INSERT INTO records VALUES(?,?,?)').run(subToday.id, 'subscriptions', JSON.stringify(subToday));

    // Run automation
    subscriptionAutomation();
    // Allow any pending async email dispatches to settle
    await new Promise(r => setTimeout(r, 100));

    // Verify notices recorded in SQLite expiry_notices table
    const notices = db.prepare('SELECT subscriptionId, stage FROM expiry_notices').all();
    assert.ok(notices.some(n => n.subscriptionId === subWeek.id && n.stage === 'week_before'), '7 days before expiry notice must be recorded');
    assert.ok(notices.some(n => n.subscriptionId === subDay.id && n.stage === 'day_before'), '1 day before expiry notice must be recorded');
    assert.ok(notices.some(n => n.subscriptionId === subToday.id && n.stage === 'on_expiry'), 'on expiry date notice must be recorded');

    // Verify in-app notifications generated for customer
    const notifications = db.prepare('SELECT title, message, type FROM notifications WHERE userId=?').all('user-sarah');
    assert.ok(notifications.some(n => n.type === 'subscription-expiry-week_before'), 'in-app notification for 1 week before');
    assert.ok(notifications.some(n => n.type === 'subscription-expiry-day_before'), 'in-app notification for 1 day before');
    assert.ok(notifications.some(n => n.type === 'subscription-expiry-on_expiry'), 'in-app notification for on expiry date');

    // Verify idempotency: running automation again must not create duplicate records
    const initialNoticeCount = db.prepare('SELECT COUNT(*) as count FROM expiry_notices').get().count;
    subscriptionAutomation();
    await new Promise(r => setTimeout(r, 50));
    const secondaryNoticeCount = db.prepare('SELECT COUNT(*) as count FROM expiry_notices').get().count;
    assert.equal(initialNoticeCount, secondaryNoticeCount, 'Automation must be idempotent and avoid duplicate notices');

  } finally {
    server.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
