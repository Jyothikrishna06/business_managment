import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {seedSoftware} from '../scripts/seed-software-demo.js';

test('Customer instant checkout with Pay Now skips staff approval and activates immediately', async t => {
 Object.assign(process.env,{BOOTSTRAP_ADMIN_EMAIL:'make_a_ton@gmail.com',BOOTSTRAP_ADMIN_PASSWORD:'makeaton123',DEV_RESET_LINKS:'false',SMTP_HOST:'',ENABLE_DEMO_CHECKOUT:'false'});
  const dir = mkdtempSync(join(tmpdir(), 'brightloop-paynow-'));
  Object.assign(process.env, {PORT: '0', DATA_DIR: dir, BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test', BOOTSTRAP_ADMIN_PASSWORD: 'AdminPass!42', SMTP_HOST: '', ENABLE_DEMO_CHECKOUT:'true'});
  const {server} = await import('../server.js?suite=pay-now.test');
  if (!server.listening) await once(server, 'listening');
  t.after(async () => {
    await new Promise(r => server.close(r));
    rmSync(dir, {recursive: true, force: true});
  });

  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, method = 'GET', body, cookie) => {
    const r = await fetch(base + path, {
      method,
      headers: {'content-type': 'application/json', ...(cookie ? {cookie} : {})},
      body: body ? JSON.stringify(body) : undefined
    });
    return {status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0]};
  };

  const db = new DatabaseSync(join(dir, 'subscript.db'));
  seedSoftware(db);
  db.close();

  // Register customer
  const reg = await call('/auth/register', 'POST', {name: 'Jane Customer', email: 'jane@example.test', password: 'CustomerPass!42'});
  assert.equal(reg.status, 200);
  const cookie = (await call('/auth/login', 'POST', {email: 'jane@example.test', password: 'CustomerPass!42'})).cookie;

  // Retrieve available software products
  const state1 = (await call('/state', 'GET', null, cookie)).body;
  const accounting = state1.catalog.find(p => p.name === 'Accounting Software');
  assert.ok(accounting);
  const monthlyPlan = accounting.plans.find(p => p.cycle === 'Monthly');
  assert.ok(monthlyPlan);

  // 1. Pay Now checkout directly
  const checkoutPayload = {
    planId: monthlyPlan.id,
    variantId: 'odoo',
    quantity: 1,
    payNow: true
  };
  const res = await call('/customer/subscriptions', 'POST', checkoutPayload, cookie);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const sub = res.body;

  // Verify subscription is Active without staff approval
  assert.equal(sub.status, 'Active');
  assert.equal(sub.terms, 'Demo Instant Payment');
  assert.ok(sub.nextBilling > sub.starts, 'Next billing date must be set in the future');

  // Verify invoice and payment were automatically recorded
  const state2 = (await call('/state', 'GET', null, cookie)).body;
  const mySub = state2.subscriptions.find(s => s.id === sub.id);
  assert.ok(mySub);
  assert.equal(mySub.status, 'Active');

  const myInvoice = state2.invoices.find(i => i.subscriptionId === sub.id);
  assert.ok(myInvoice, 'An invoice should be automatically generated for Pay Now');
  assert.equal(myInvoice.status, 'Paid');

  const myPayment = state2.payments.find(p => p.invoiceId === myInvoice.id);
  assert.ok(myPayment, 'A payment record should exist for the instant checkout');
  assert.equal(myPayment.method, 'Card');
  assert.equal(myPayment.notes, 'Demo instant checkout payment');

  // 2. Draft subscription can also be paid via /pay
  const draftPayload = {
    planId: monthlyPlan.id,
    variantId: 'basic',
    quantity: 1
  };
  const draftRes = await call('/customer/subscriptions', 'POST', draftPayload, cookie);
  assert.equal(draftRes.status, 200);
  assert.equal(draftRes.body.status, 'Draft');

  const payRes = await call(`/customer/subscriptions/${draftRes.body.id}/pay`, 'POST', {}, cookie);
  assert.equal(payRes.status, 200, JSON.stringify(payRes.body));
  assert.equal(payRes.body.status, 'Active');

  const state3 = (await call('/state', 'GET', null, cookie)).body;
  const draftSubActivated = state3.subscriptions.find(s => s.id === draftRes.body.id);
  assert.equal(draftSubActivated.status, 'Active');
});
