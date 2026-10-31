import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {once} from 'node:events';

test('admin portal: login, staff management, customer accounts, summaries, rbac', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'subscript-admin-test-'));
  const port = 14000 + Math.floor(Math.random() * 10000);
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
    if (p.startsWith(resolve(tmpdir()) + sep) && p.includes('subscript-admin-test-')) {
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

  // 1. Admin Login test with make_a_ton@gmail.com / makeaton123
  const adminCreds = {email: 'make_a_ton@gmail.com', password: 'makeaton123'};
  const adminLogin = await call('/auth/login', 'POST', adminCreds);
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.body.user.role, 'admin');
  assert.equal(adminLogin.body.user.email, 'make_a_ton@gmail.com');
  const adminCookie = adminLogin.cookie;

  // 2. Admin dashboard stats summary
  let stats = await call('/admin/stats', 'GET', null, adminCookie);
  assert.equal(stats.status, 200);
  assert.equal(typeof stats.body.mrr, 'number');
  assert.equal(typeof stats.body.totalRevenue, 'number');
  assert.equal(typeof stats.body.owed, 'number');
  assert.equal(typeof stats.body.activeSubscriptions, 'number');
  assert.equal(typeof stats.body.totalCustomers, 'number');

  // 3. Create a customer and verify in /admin/customers and state
  const custPass = 'CustomerPass123';
  const regCust = await call('/auth/register', 'POST', {name: 'Jane Customer', email: 'jane@example.com', password: custPass});
  assert.equal(regCust.status, 200);

  const adminCustomers = await call('/admin/customers', 'GET', null, adminCookie);
  assert.equal(adminCustomers.status, 200);
  assert.equal(adminCustomers.body.some(c => c.email === 'jane@example.com'), true);

  // 4. Staff Management: Add Staff
  const staffPass = 'StaffSecret123';
  const createStaff = await call('/staff', 'POST', {name: 'Alice Support', email: 'alice@example.com', password: staffPass}, adminCookie);
  assert.equal(createStaff.status, 200);

  // 5. Staff Login test
  const staffLogin = await call('/auth/login', 'POST', {email: 'alice@example.com', password: staffPass});
  assert.equal(staffLogin.status, 200);
  assert.equal(staffLogin.body.user.role, 'staff');
  assert.equal(staffLogin.body.user.status, 'active');
  const staffCookie = staffLogin.cookie;

  // 6. RBAC Protection: Staff cannot access admin endpoints
  assert.equal((await call('/admin/stats', 'GET', null, staffCookie)).status, 403);
  assert.equal((await call('/admin/customers', 'GET', null, staffCookie)).status, 403);
  assert.equal((await call('/admin/audit', 'GET', null, staffCookie)).status, 403);
  assert.equal((await call('/team', 'GET', null, staffCookie)).status, 403);
  assert.equal((await call('/staff', 'POST', {name: 'Hacker', email: 'h@ex.com', password: 'Pass1234'}, staffCookie)).status, 403);

  // 7. Staff Management: Edit Staff
  const teamList = await call('/team', 'GET', null, adminCookie);
  assert.equal(teamList.status, 200);
  const alice = teamList.body.find(u => u.email === 'alice@example.com');
  assert.ok(alice);
  assert.equal(alice.status, 'active');

  const editStaff = await call(`/staff/${alice.id}`, 'POST', {name: 'Alice Operations', email: 'alice.ops@example.com'}, adminCookie);
  assert.equal(editStaff.status, 200);

  // Login with updated email
  const loginUpdated = await call('/auth/login', 'POST', {email: 'alice.ops@example.com', password: staffPass});
  assert.equal(loginUpdated.status, 200);
  assert.equal(loginUpdated.body.user.name, 'Alice Operations');

  // 8. Staff Management: Reset Staff Password
  const newStaffPass = 'NewStaffPass456';
  const resetStaff = await call(`/staff/${alice.id}/reset`, 'POST', {password: newStaffPass}, adminCookie);
  assert.equal(resetStaff.status, 200);

  // Old password must fail
  assert.equal((await call('/auth/login', 'POST', {email: 'alice.ops@example.com', password: staffPass})).status, 401);
  // New password must succeed
  const loginReset = await call('/auth/login', 'POST', {email: 'alice.ops@example.com', password: newStaffPass});
  assert.equal(loginReset.status, 200);

  // 9. Staff Management: Deactivate Staff Account
  const deactStaff = await call(`/staff/${alice.id}/deactivate`, 'POST', {}, adminCookie);
  assert.equal(deactStaff.status, 200);

  // Deactivated staff login must be rejected
  const loginDeact = await call('/auth/login', 'POST', {email: 'alice.ops@example.com', password: newStaffPass});
  assert.equal(loginDeact.status, 403);

  // 10. Staff Management: Reactivate Staff Account
  const reactStaff = await call(`/staff/${alice.id}/activate`, 'POST', {}, adminCookie);
  assert.equal(reactStaff.status, 200);

  const loginReact = await call('/auth/login', 'POST', {email: 'alice.ops@example.com', password: newStaffPass});
  assert.equal(loginReact.status, 200);

  // 11. Admin self-deactivation protection
  const adminUser = teamList.body.find(u => u.role === 'admin');
  const selfDeact = await call(`/staff/${adminUser.id}/deactivate`, 'POST', {}, adminCookie);
  assert.equal(selfDeact.status, 400);

  // 12. Subscription & Plan Management by Admin
  const product = (await call('/records/products', 'POST', {name: 'Enterprise License', price: 200, cost: 50}, adminCookie)).body;
  const plan = (await call('/records/plans', 'POST', {name: 'Annual Enterprise', cycle: 'Yearly', minQuantity: 1}, adminCookie)).body;
  const customerRecord = (await call('/records/customers', 'POST', {name: 'Jane Customer', email: 'jane@example.com'}, adminCookie)).body;
  
  const today = new Date().toISOString().slice(0, 10);
  const sub = (await call('/records/subscriptions', 'POST', {
    number: 'SUB-ENT-001',
    customerId: customerRecord.id,
    productId: product.id,
    planId: plan.id,
    quantity: 1,
    unitPrice: 200,
    starts: today,
    status: 'Active'
  }, adminCookie)).body;

  assert.equal(sub.status, 'Active');

  // Run billing
  const billResult = await call('/billing', 'POST', {}, adminCookie);
  assert.equal(billResult.status, 200);
  assert.equal(billResult.body.count, 1);

  // Verify updated admin stats reflect new subscription and billing
  stats = await call('/admin/stats', 'GET', null, adminCookie);
  assert.equal(stats.status, 200);
  assert.ok(stats.body.totalSubscriptions >= 1);
  assert.ok(stats.body.totalInvoices >= 1);
  assert.ok(stats.body.owed > 0);
});
