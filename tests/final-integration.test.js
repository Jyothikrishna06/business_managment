import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';

test('final integration: billing scale, assignment isolation, invoice ownership and profile linking',async t=>{
 Object.assign(process.env,{DEV_RESET_LINKS:'false',ENABLE_DEMO_CHECKOUT:'false'});
 const dir=mkdtempSync(join(tmpdir(),'brightloop-final-'));
 Object.assign(process.env,{PORT:'0',DATA_DIR:dir,BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',BOOTSTRAP_ADMIN_PASSWORD:'AdminPass!42',SMTP_HOST:''});
 const {server}=await import('../server.js?suite=final-integration');if(!server.listening)await once(server,'listening');
 t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const call=async(path,method='GET',body,cookie)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const admin=(await call('/auth/login','POST',{email:'admin@example.test',password:'AdminPass!42'})).cookie;
 await call('/staff','POST',{name:'Operations',email:'staff@example.test',password:'StaffPass!42'},admin);
 const login=await call('/auth/login','POST',{email:'staff@example.test',password:'StaffPass!42'}),staff=login.cookie;
 const create=async(type,body)=>{const r=await call('/records/'+type,'POST',body,admin);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
 const product=await create('products',{name:'CRM Software',productType:'Software',currency:'INR',price:999,cost:300}),plan=await create('plans',{name:'Monthly',productId:product.id,currency:'INR',price:999,cycle:'Monthly',minQuantity:1,allowPause:true});
 const customer=await create('customers',{name:'Assigned company',email:'assigned@example.test',assignedStaffId:login.body.user.id}),hidden=await create('customers',{name:'Private company',email:'private@example.test'});
 const today=new Date().toISOString().slice(0,10),db=new DatabaseSync(join(dir,'subscript.db')),insert=db.prepare('INSERT INTO records VALUES(?,?,?)');
 db.exec('BEGIN');
 for(let n=0;n<3000;n++){const id=randomBytes(12).toString('hex');insert.run(id,'subscriptions',JSON.stringify({id,number:'SCALE-'+n,businessType:'software',customerId:n===0?customer.id:hidden.id,productId:product.id,planId:plan.id,currency:'INR',cycle:'Monthly',quantity:1,unitPrice:999,status:'Active',starts:today,nextBilling:today,terms:'Net 15'}));}
 db.exec('COMMIT');db.close();
 let start=performance.now();const billed=await call('/billing','POST',{},admin);const billingMs=performance.now()-start;
 assert.equal(billed.status,200);assert.equal(billed.body.count,3000);assert.ok(billingMs<2000,`3,000 invoices: ${billingMs.toFixed(0)}ms`);
 start=performance.now();const state=(await call('/state','GET',null,admin)).body;const stateMs=performance.now()-start;assert.ok(stateMs<2000,`3,000-record state: ${stateMs.toFixed(0)}ms`);
 start=performance.now();assert.equal((await call('/admin/stats?currency=INR','GET',null,admin)).status,200);const statsMs=performance.now()-start;assert.ok(statsMs<2000);
 console.log(`Local 3,000-subscription check: billing ${billingMs.toFixed(0)}ms; state ${stateMs.toFixed(0)}ms; summary ${statsMs.toFixed(0)}ms`);
 assert.equal((await call('/billing','POST',{},admin)).body.count,0);
 const visible=(await call('/state','GET',null,staff)).body;assert.equal(visible.subscriptions.length,1);assert.equal(visible.invoices.length,1);
 const ownInvoice=visible.invoices[0],privateInvoice=state.invoices.find(i=>i.customerId===hidden.id);
 for(const action of ['confirm','cancel','send'])assert.equal((await call('/invoice-action','POST',{id:privateInvoice.id,action},staff)).status,404);
 assert.equal((await call('/invoice-action','POST',{id:ownInvoice.id,action:'confirm'},staff)).status,200);
 assert.equal((await call('/records/payments','POST',{invoiceId:privateInvoice.id,amount:1,date:today,method:'Cash'},staff)).status,404);
 assert.equal((await call('/records/payments','POST',{invoiceId:ownInvoice.id,amount:100,date:today,method:'Cash'},staff)).status,200);
 assert.equal((await call('/records/subscriptions','POST',{...visible.subscriptions[0],status:'Active'},staff)).status,400,'New software contracts start as Draft');
 // A matching email must never silently claim an unlinked billing record on profile changes.
 const unlinked=await create('customers',{name:'Unlinked business',email:'portal@example.test'});
 await call('/auth/register','POST',{name:'Portal owner',email:'portal@example.test',password:'CustomerPass!42'});
 const portal=(await call('/auth/login','POST',{email:'portal@example.test',password:'CustomerPass!42'})).cookie;
 await call('/profile','POST',{name:'Updated portal owner'},portal);
 const adminState=(await call('/state','GET',null,admin)).body;assert.equal(adminState.customers.find(c=>c.id===unlinked.id).name,'Unlinked business');
 const own=(await call('/state','GET',null,portal)).body;assert.equal(own.customers.length,1);assert.equal(own.invoices.length,0);assert.equal(own.customers[0].name,'Updated portal owner');
 assert.equal((await call('/users/'+login.body.user.id+'/deactivate','POST',{},portal)).status,403);
 // Reassignment immediately revokes staff access to invoices, payments, and contract mutation.
 await call('/records/customers/'+customer.id,'PATCH',{assignedStaffId:''},admin);
 const revoked=(await call('/state','GET',null,staff)).body;assert.equal(revoked.invoices.length,0);assert.equal(revoked.payments.length,0);
 assert.equal((await call('/invoice-action','POST',{id:ownInvoice.id,action:'cancel'},staff)).status,404);
});
