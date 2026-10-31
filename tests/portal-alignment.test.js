import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {seedSoftware} from '../scripts/seed-software-demo.js';

test('alignment of customer, admin, and staff portals: details, variants, permissions, and management', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'portal-alignment-test-'));
  const port = 16000 + Math.floor(Math.random() * 10000);
  
  const db = new DatabaseSync(join(dir, 'subscript.db'));
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT,status TEXT DEFAULT 'active'); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,userId TEXT,expires INTEGER); CREATE TABLE IF NOT EXISTS resets(token TEXT PRIMARY KEY,userId TEXT,expires INTEGER); CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,type TEXT,body TEXT); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,time TEXT,userId TEXT,action TEXT);`);
  seedSoftware(db);
  db.close();

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {...process.env, PORT: String(port), APP_URL: `http://localhost:${port}`, DATA_DIR: dir, DEV_RESET_LINKS: 'true', SMTP_HOST: ''},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', d => output += d);
  child.stderr.on('data', d => output += d);

  t.after(async () => {
    child.kill();
    if (child.exitCode === null) await once(child, 'exit');
    const p = resolve(dir);
    if (p.startsWith(resolve(tmpdir()) + sep) && p.includes('portal-alignment-test-')) {
      rmSync(p, {recursive: true, force: true});
    }
  });

  for (let n = 0; n < 100 && !output.includes('running at'); n++) await new Promise(r => setTimeout(r, 50));
  assert.match(output, /running at/);

  const call = async (path, method = 'GET', body, cookie) => {
    const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: {'Content-Type': 'application/json', ...(cookie ? {cookie} : {})},
      body: body ? JSON.stringify(body) : undefined
    });
    return {status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0]};
  };

  // 1. Admin login
  const adminLogin = await call('/auth/login', 'POST', {email: 'make_a_ton@gmail.com', password: 'makeaton123'});
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.cookie;

  // 2. Admin creates a staff member
  const staffEmail = 'staff.john@brightloop.test';
  const staffPass = 'StaffPassword123!';
  const createStaff = await call('/staff', 'POST', {name: 'John Staff', email: staffEmail, password: staffPass}, adminCookie);
  assert.equal(createStaff.status, 200);

  // Staff login
  const staffLogin = await call('/auth/login', 'POST', {email: staffEmail, password: staffPass});
  assert.equal(staffLogin.status, 200);
  assert.equal(staffLogin.body.user.role, 'staff');
  const staffCookie = staffLogin.cookie;

  // 3. Customer registration & login
  const custEmail = 'anita.customer@brightloop.test';
  const custPass = 'CustomerPass123!';
  const custReg = await call('/auth/register', 'POST', {name: 'Anita Roy', email: custEmail, password: custPass});
  assert.equal(custReg.status, 200);

  const custLogin = await call('/auth/login', 'POST', {email: custEmail, password: custPass});
  assert.equal(custLogin.status, 200);
  assert.equal(custLogin.body.user.role, 'customer');
  const custCookie = custLogin.cookie;

  // 4. Customer browses catalog and chooses Accounting Software with Odoo variant
  const custState = await call('/state', 'GET', null, custCookie);
  assert.equal(custState.status, 200);
  const acctProd = custState.body.catalog.find(p => p.name === 'Accounting Software');
  assert.ok(acctProd);
  const odooVariant = acctProd.variants.find(v => v.name === 'Odoo');
  assert.equal(odooVariant.extraPrice, 560);
  const monthlyPlan = acctProd.plans.find(p => p.cycle === 'Monthly');
  assert.equal(monthlyPlan.price, 500);

  // Customer creates a draft subscription: 1 unit of Accounting Software · Odoo
  const subReq = await call('/customer/subscriptions', 'POST', {
    planId: monthlyPlan.id,
    variantId: odooVariant.id,
    quantity: 1
  }, custCookie);
  assert.equal(subReq.status, 200);
  const sub = subReq.body;
  assert.equal(sub.status, 'Draft');
  assert.equal(sub.unitPrice, 1060);
  assert.equal(sub.variantName, 'Odoo');
  assert.equal(sub.currency, 'INR');

  // 5. Staff and Admin verify the subscription details match the customer page
  const staffState = await call('/state', 'GET', null, staffCookie);
  assert.equal(staffState.status, 200);
  const staffFoundSub = staffState.body.subscriptions.find(s => s.id === sub.id);
  assert.ok(staffFoundSub);
  assert.equal(staffFoundSub.variantName, 'Odoo');
  assert.equal(staffFoundSub.unitPrice, 1060);
  assert.equal(staffFoundSub.status, 'Draft');

  // Staff confirms the customer's draft subscription (setting status to Confirmed)
  const confirmRes = await call(`/records/subscriptions/${sub.id}`, 'PATCH', {status: 'Confirmed'}, staffCookie);
  assert.equal(confirmRes.status, 200);
  assert.equal(confirmRes.body.status, 'Confirmed');

  // Staff activates the subscription (setting status to Active)
  const activateRes = await call(`/records/subscriptions/${sub.id}`, 'PATCH', {status: 'Active'}, staffCookie);
  assert.equal(activateRes.status, 200);
  assert.equal(activateRes.body.status, 'Active');

  // Customer checks subscription is now Active
  const custUpdatedState = await call('/state', 'GET', null, custCookie);
  const custSub = custUpdatedState.body.subscriptions.find(s => s.id === sub.id);
  assert.equal(custSub.status, 'Active');

  // 6. Pause and Resume: customer pauses, staff resumes
  const pauseRes = await call(`/customer/subscriptions/${sub.id}`, 'PATCH', {action: 'pause'}, custCookie);
  assert.equal(pauseRes.status, 200);
  assert.equal(pauseRes.body.status, 'Paused');

  const resumeRes = await call(`/records/subscriptions/${sub.id}`, 'PATCH', {status: 'Active'}, staffCookie);
  assert.equal(resumeRes.status, 200);
  assert.equal(resumeRes.body.status, 'Active');

  // 7. Customer profile name update syncs with customer record
  const profileRes = await call('/profile', 'POST', {name: 'Anita Roy Updated'}, custCookie);
  assert.equal(profileRes.status, 200);
  assert.equal(profileRes.body.user.name, 'Anita Roy Updated');

  // Verify staff sees updated customer name in state
  const staffStateAfterProfile = await call('/state', 'GET', null, staffCookie);
  const updatedCustRecord = staffStateAfterProfile.body.customers.find(c => c.email === custEmail);
  assert.equal(updatedCustRecord.name, 'Anita Roy Updated');

  // 8. Admin customer account management: deactivate, activate, reset
  const adminCustList = await call('/admin/customers', 'GET', null, adminCookie);
  assert.equal(adminCustList.status, 200);
  const registeredCust = adminCustList.body.find(c => c.email === custEmail);
  assert.ok(registeredCust);

  // Deactivate customer account
  const deactRes = await call(`/users/${registeredCust.id}/deactivate`, 'POST', {}, adminCookie);
  assert.equal(deactRes.status, 200);

  // Deactivated customer cannot log in
  const blockedLogin = await call('/auth/login', 'POST', {email: custEmail, password: custPass});
  assert.equal(blockedLogin.status, 403);

  // Reactivate customer account
  const reactRes = await call(`/users/${registeredCust.id}/activate`, 'POST', {}, adminCookie);
  assert.equal(reactRes.status, 200);

  // Reset password
  const newPass = 'NewCustomerPass456!';
  const resetRes = await call(`/users/${registeredCust.id}/reset`, 'POST', {password: newPass}, adminCookie);
  assert.equal(resetRes.status, 200);

  // Customer logs in with new password
  const newLogin = await call('/auth/login', 'POST', {email: custEmail, password: newPass});
  assert.equal(newLogin.status, 200);
});
