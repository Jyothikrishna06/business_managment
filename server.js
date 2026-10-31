import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const root = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(process.env.DATA_DIR || `${root}data`, { recursive: true });
const db = new DatabaseSync(`${process.env.DATA_DIR || `${root}data`}/subscript.db`);
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,userId TEXT,expires INTEGER); CREATE TABLE IF NOT EXISTS resets(token TEXT PRIMARY KEY,userId TEXT,expires INTEGER); CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,type TEXT,body TEXT); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,time TEXT,userId TEXT,action TEXT);`);
const types = ['products','plans','customers','quotations','subscriptions','invoices','payments','discounts','taxes'];
const hash = v => createHash('sha256').update(v).digest('hex');
const uid = () => randomBytes(12).toString('hex');
const passwordHash = password => { const salt = uid(); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; };
const validPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p);
const publicUser = u => ({ id:u.id,name:u.name,email:u.email,role:u.role });
const all = type => db.prepare('SELECT body FROM records WHERE type=?').all(type).map(r=>JSON.parse(r.body));
const put = (type,r) => { db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?)').run(r.id,type,JSON.stringify(r)); return r; };
function fail(message,code=400){ throw Object.assign(new Error(message),{code}); }
function audit(user,action){ db.prepare('INSERT INTO audit(time,userId,action) VALUES(?,?,?)').run(new Date().toISOString(),user?.id||'system',action); }
function ensureBootstrapAdmin(){
  const email=(process.env.BOOTSTRAP_ADMIN_EMAIL||'make_a_ton@gmail.com').trim().toLowerCase();
  const password=process.env.BOOTSTRAP_ADMIN_PASSWORD||'makeaton123';
  const existing=db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if(!existing) db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(uid(),'Make A Ton Admin',email,passwordHash(password),'admin');
}
ensureBootstrapAdmin();
function calculate(s,date){
  const product=all('products').find(p=>p.id===s.productId); const quantity=Number(s.quantity); const subtotal=Number(s.unitPrice ?? product?.price ?? 0)*quantity;
  const discount=all('discounts').find(d=>d.id===s.discountId);
  let deduction=0;
  if(discount && (!discount.starts||discount.starts<=date) && (!discount.ends||discount.ends>=date) && (!discount.limit||Number(discount.used||0)<Number(discount.limit)) && quantity>=Number(discount.minQuantity||1)) {
    deduction=discount.kind==='Percentage'?subtotal*Number(discount.value)/100:Number(discount.value);
  }
  deduction=Math.min(subtotal,deduction);
  const tax=all('taxes').find(t=>t.id===s.taxId); const taxAmount=(subtotal-deduction)*Number(tax?.rate||0)/100;
  return {subtotal,discount:deduction,tax:taxAmount,total:Math.round((subtotal-deduction+taxAmount)*100)/100};
}
function nextDate(date,cycle,anchor){ const d=new Date(`${date}T12:00:00Z`); const day=d.getUTCDate(); if(cycle==='Daily')d.setUTCDate(day+1);else if(cycle==='Weekly')d.setUTCDate(day+7);else {d.setUTCDate(1);if(cycle==='Yearly')d.setUTCFullYear(d.getUTCFullYear()+1);else d.setUTCMonth(d.getUTCMonth()+1);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(anchor||day,last));}return d.toISOString().slice(0,10); }
function bill(){
  const today=new Date().toISOString().slice(0,10);let count=0;db.exec('BEGIN IMMEDIATE');
  try{for(const s of all('subscriptions')){
    if(s.status!=='Active')continue;let due=s.nextBilling||s.starts;let n=0;
    while(due&&due<=today&&n++<120){
      if(s.ends&&due>s.ends){s.status='Closed';break;}
      if(!all('invoices').some(i=>i.subscriptionId===s.id&&i.billingDate===due)){
        const totals=calculate(s,due),customer=all('customers').find(c=>c.id===s.customerId),product=all('products').find(p=>p.id===s.productId);
        const dueDate=new Date(`${due}T12:00:00Z`);dueDate.setUTCDate(dueDate.getUTCDate()+Number(String(s.terms||'').match(/Net (7|15|30|60)/)?.[1]||0));
        put('invoices',{id:uid(),number:`INV-${uid().slice(0,8).toUpperCase()}`,customerId:s.customerId,subscriptionId:s.id,billingDate:due,due:dueDate.toISOString().slice(0,10),status:totals.total===0?'Paid':'Confirmed',line:{name:product.name,quantity:s.quantity,unitPrice:s.unitPrice},customer:{name:customer.name,email:customer.email},terms:s.terms||'',...totals});count++;
        if(totals.discount&&s.discountId){const d=all('discounts').find(d=>d.id===s.discountId);put('discounts',{...d,used:Number(d.used||0)+1});}
      }
      due=nextDate(due,s.cycle||'Monthly',Number(s.starts.slice(8,10)));
    }
    if(s.ends&&s.ends<today&&due>s.ends)s.status='Closed';s.nextBilling=due;put('subscriptions',s);
  }db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return count;
}
const attempts=new Map();
function throttle(key){const now=Date.now();const item=attempts.get(key)||{n:0,expires:now+900000};if(item.expires<now){item.n=0;item.expires=now+900000;}item.n++;attempts.set(key,item);if(item.n>30)fail('Too many attempts. Please try again in 15 minutes.',429);}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>100000)fail('Request too large',413);}try{return data?JSON.parse(data):{};}catch{fail('Invalid JSON');}}
function validate(type,r){
  if(['products','plans','customers','discounts','taxes'].includes(type)&&!String(r.name||'').trim())fail('Name is required.');
  for(const key of ['price','cost','quantity','unitPrice','value','rate','minQuantity','limit','amount'])if(r[key]!==undefined && (!Number.isFinite(Number(r[key]))||Number(r[key])<0||Number(r[key])>1e10))fail(`${key} must be a valid positive number.`);
  if(type==='customers'){if(!/^\S+@\S+\.\S+$/.test(r.email||''))fail('Enter a valid customer email.');r.email=r.email.toLowerCase().trim();}
  if(type==='plans'&&!['Daily','Weekly','Monthly','Yearly'].includes(r.cycle))fail('Choose a billing cycle.');
  if(type==='discounts'&&!['Fixed','Percentage'].includes(r.kind))fail('Choose a discount type.');
  if(type==='taxes'&&Number(r.rate)>100)fail('Tax rate cannot exceed 100%.');
  if(type==='discounts'&&r.kind==='Percentage'&&Number(r.value)>100)fail('Discount cannot exceed 100%.');
  for(const key of ['starts','ends','due','date'])if(r[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(r[key])||!Number.isFinite(Date.parse(r[key]))))fail('Enter valid dates.');
  if(r.starts&&r.ends&&r.ends<r.starts)fail('End date must follow start date.');
  if(['subscriptions','quotations'].includes(type)){
    if(!all('customers').some(c=>c.id===r.customerId))fail('Choose a customer.');
    if(!all('products').some(c=>c.id===r.productId))fail('Choose a product.');
    const plan=all('plans').find(c=>c.id===r.planId);if(!plan)fail('Choose a plan.');
    if(!Number.isFinite(Number(r.unitPrice))||!Number.isInteger(Number(r.quantity))||Number(r.quantity)<Math.max(1,Number(plan.minQuantity||1)))fail('Enter a valid price and a whole quantity above the plan minimum.');
    if((plan.starts&&r.starts<plan.starts)||(plan.ends&&r.starts>plan.ends))fail('The plan is unavailable on this start date.');
    if(r.taxId&&!all('taxes').some(t=>t.id===r.taxId))fail('Choose a valid tax rule.');
    if(r.discountId&&!all('discounts').some(t=>t.id===r.discountId))fail('Choose a valid discount.');
    if(!r.starts)fail('Start date is required.');r.cycle=plan.cycle;
    if(type==='subscriptions'&&!['Draft','Quotation','Confirmed','Active','Paused','Closed'].includes(r.status))fail('Invalid status.');
  }
}
// Staff access is scoped on the server; hiding navigation alone is insufficient.
function assignedCustomer(user,id){
  const customer=all('customers').find(c=>c.id===id&&c.assignedStaffId===user.id);
  if(!customer)fail('Assigned customer not found.',404);
  return customer;
}
function staffState(user){
  const customers=all('customers').filter(c=>c.assignedStaffId===user.id);
  const ids=new Set(customers.map(c=>c.id));
  return {
    customers:customers.map(({id,name,email,company,phone,notes})=>({id,name,email,company,phone,notes})),
    subscriptions:all('subscriptions').filter(s=>ids.has(s.customerId)).map(({id,number,customerId,status,starts,ends,nextBilling,cycle})=>({id,number,customerId,status,starts,ends,nextBilling,cycle})),
    tasks:all('staffTasks').filter(t=>t.assignedStaffId===user.id&&ids.has(t.customerId)),
    support:all('staffSupport').filter(t=>ids.has(t.customerId)),
    activity:db.prepare('SELECT time,action FROM audit WHERE userId=? ORDER BY id DESC LIMIT 50').all(user.id)
  };
}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');const path=url.pathname;const send=(data,code=200,headers={})=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));};try{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  if(!path.startsWith('/api/')){const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/staff.js':'staff.js','/styles.css':'styles.css'};if(!files[path])return send({error:'Not found'},404);res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(`${root}${files[path]}`));return;}
  if(req.method!=='GET' && req.headers.origin && req.headers.origin!==`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`)fail('Invalid request origin.',403);
  const b=req.method==='GET'?{}:await body(req);const email=String(b.email||'').trim().toLowerCase();
  if(path==='/api/auth/register'&&req.method==='POST'){
    throttle(req.socket.remoteAddress);if(!b.name?.trim()||!/^\S+@\S+\.\S+$/.test(email))fail('Enter your name and a valid email.');if(!validPassword(b.password))fail('Use at least 8 characters with a letter and a number.');
    if(db.prepare('SELECT id FROM users WHERE email=?').get(email))fail('An account already exists with this email.');
    const role='customer';const u={id:uid(),name:b.name.trim(),email,password:passwordHash(b.password),role};db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(u.id,u.name,email,u.password,role);put('customers',{id:uid(),name:u.name,email,userId:u.id});audit(u,'Customer account registered');return send({ok:true});
  }
  if(path==='/api/auth/login'&&req.method==='POST'){
    throttle(req.socket.remoteAddress);const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);const [salt,saved]=(u?.password||`${uid()}:${'0'.repeat(128)}`).split(':');const computed=scryptSync(String(b.password||''),salt,64);if(!u||!timingSafeEqual(computed,Buffer.from(saved,'hex')))fail('Email or password is incorrect.',401);
    const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),u.id,Date.now()+86400000);return send({user:publicUser(u)},200,{'Set-Cookie':`session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${process.env.APP_URL?.startsWith('https')?'; Secure':''}`});
  }
  if(path==='/api/auth/forgot'&&req.method==='POST'){
    throttle(req.socket.remoteAddress);const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if(!process.env.SMTP_HOST && process.env.DEV_RESET_LINKS!=='true')fail('Email delivery is not configured. Contact your administrator.',503);
    if(u){const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM resets WHERE userId=?').run(u.id);db.prepare('INSERT INTO resets VALUES(?,?,?)').run(hash(token),u.id,Date.now()+1800000);const link=`${process.env.APP_URL||'http://localhost:3000'}/?reset=${token}`;if(process.env.SMTP_HOST){await nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_PORT==='465',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined}).sendMail({from:process.env.MAIL_FROM,to:email,subject:'Reset your Subscript password',text:`Reset your password using this link (expires in 30 minutes):\n${link}\nIf you did not request this, ignore this email.`});}else console.log(`Local password reset for ${email}: ${link}`);}
    return send({message:'If an account exists, a password reset link has been requested. It expires in 30 minutes.'});
  }
  if(path==='/api/auth/reset'&&req.method==='POST'){
    throttle(req.socket.remoteAddress);if(!validPassword(b.password))fail('Use at least 8 characters with a letter and a number.');const r=db.prepare('SELECT * FROM resets WHERE token=? AND expires>?').get(hash(String(b.token)),Date.now());if(!r)fail('This link is invalid or expired. Request a new reset link.');db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(b.password),r.userId);db.prepare('DELETE FROM resets WHERE userId=?').run(r.userId);db.prepare('DELETE FROM sessions WHERE userId=?').run(r.userId);return send({ok:true});
  }
  const token=(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('session='))?.slice(8);const session=token&&db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(hash(token),Date.now());const u=session&&db.prepare('SELECT * FROM users WHERE id=?').get(session.userId);if(!u)fail('Please sign in.',401);
  if(path==='/api/auth/me'&&req.method==='GET')return send({user:publicUser(u)});
  if(path==='/api/auth/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));return send({ok:true},200,{'Set-Cookie':'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});}
  if(path==='/api/profile'&&req.method==='POST'){if(!b.name?.trim())fail('Name is required.');db.prepare('UPDATE users SET name=? WHERE id=?').run(b.name.trim(),u.id);return send({user:{...publicUser(u),name:b.name.trim()}});}
  if(path==='/api/state'&&req.method==='GET'&&u.role==='staff')return send(staffState(u));
  if(path==='/api/state'&&req.method==='GET'){const data=Object.fromEntries(types.map(t=>[t,all(t)]));if(u.role==='customer'){const ids=data.customers.filter(c=>c.userId===u.id).map(c=>c.id);for(const t of ['subscriptions','quotations','invoices'])data[t]=data[t].filter(r=>ids.includes(r.customerId));const invoices=data.invoices.map(i=>i.id);data.payments=data.payments.filter(p=>invoices.includes(p.invoiceId));data.customers=data.customers.filter(c=>ids.includes(c.id));data.products=data.products.filter(p=>data.subscriptions.some(s=>s.productId===p.id)).map(({id,name,price})=>({id,name,price}));data.discounts=[];data.taxes=[];}return send(data);}
  if(path==='/api/staff/password'&&req.method==='POST'){
    if(u.role!=='staff')fail('Staff access required.',403);
    throttle(`password:${u.id}`);
    const [salt,saved]=u.password.split(':');
    if(!timingSafeEqual(scryptSync(String(b.currentPassword||''),salt,64),Buffer.from(saved,'hex')))fail('Current password is incorrect.');
    if(!validPassword(b.password))fail('Use at least 8 characters with a letter and a number.');
    if(b.password===b.currentPassword)fail('Choose a different password.');
    db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(b.password),u.id);
    db.prepare('DELETE FROM sessions WHERE userId=? AND token<>?').run(u.id,hash(token));
    db.prepare('DELETE FROM resets WHERE userId=?').run(u.id);
    audit(u,'Changed password');return send({ok:true});
  }
  if(path==='/api/staff/tasks'&&req.method==='POST'&&u.role==='admin'){
    if(!db.prepare("SELECT id FROM users WHERE id=? AND role='staff'").get(String(b.assignedStaffId||'')))fail('Choose a staff member.');
    const c=all('customers').find(c=>c.id===b.customerId&&c.assignedStaffId===b.assignedStaffId);
    if(!c)fail('Assign this customer to that staff member first.');
    if(!String(b.title||'').trim()||String(b.title).length>200)fail('Enter a task title under 200 characters.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(b.due||'')||!Number.isFinite(Date.parse(b.due)))fail('Enter a valid due date.');
    const task=put('staffTasks',{id:uid(),customerId:c.id,assignedStaffId:b.assignedStaffId,title:b.title.trim(),due:b.due,status:'Open'});
    audit(u,'Assigned staff task');return send(task);
  }
  if(u.role==='staff'){
    const route=path.match(/^\/api\/staff\/(customers|tasks|support)(?:\/([a-f0-9]+))?$/);
    if(!route)fail('Administrator access required.',403);
    const [,kind,id]=route;
    if(kind==='customers'&&id&&req.method==='PATCH'){
      const c=assignedCustomer(u,id),changes={};
      if(Object.keys(b).some(k=>!['name','company','phone','notes'].includes(k)))fail('Staff may only update customer contact details and notes.',403);
      for(const [k,v] of Object.entries(b)){if(typeof v!=='string'||v.length>2000)fail('Enter valid customer details.');changes[k]=v.trim();}
      if(changes.name!==undefined&&!changes.name)fail('Name is required.');
      put('customers',{...c,...changes});audit(u,`Updated assigned customer ${c.name}`);return send({ok:true});
    }
    if(kind==='tasks'&&id&&req.method==='PATCH'){
      const task=all('staffTasks').find(t=>t.id===id&&t.assignedStaffId===u.id);
      if(!task)fail('Assigned task not found.',404);assignedCustomer(u,task.customerId);
      if(!['Open','In progress','Completed'].includes(b.status))fail('Choose a valid task status.');
      put('staffTasks',{...task,status:b.status});audit(u,`Task ${b.status}: ${task.title}`);return send({ok:true});
    }
    if(kind==='support'&&!id&&req.method==='POST'){
      const c=assignedCustomer(u,b.customerId);
      if(!['Support request','Service follow-up','Contact note'].includes(b.kind))fail('Choose a service action.');
      if(typeof b.notes!=='string'||!b.notes.trim()||b.notes.length>2000)fail('Enter notes under 2000 characters.');
      const entry=put('staffSupport',{id:uid(),customerId:c.id,kind:b.kind,notes:b.notes.trim(),status:'Open',createdAt:new Date().toISOString(),createdBy:u.id});
      audit(u,`${b.kind} logged for ${c.name}`);return send(entry);
    }
    if(kind==='support'&&id&&req.method==='PATCH'){
      const entry=all('staffSupport').find(t=>t.id===id);if(!entry)fail('Service record not found.',404);assignedCustomer(u,entry.customerId);
      if(!['Open','In progress','Resolved'].includes(b.status))fail('Choose a valid service status.');
      put('staffSupport',{...entry,status:b.status});audit(u,`Service ${b.status}: ${entry.kind}`);return send({ok:true});
    }
    fail('Staff action not allowed.',403);
  }
  if(u.role==='customer')fail('You do not have permission to perform this action.',403);
  if(path==='/api/team'&&req.method==='GET'){if(u.role!=='admin')fail('Administrator access required.',403);return send(db.prepare('SELECT id,name,email,role FROM users WHERE role IN (\'admin\',\'staff\')').all());}
  if(path==='/api/invoice-action'&&req.method==='POST'){
    const i=all('invoices').find(i=>i.id===b.id);if(!i)fail('Invoice not found.',404);
    if(b.action==='cancel'){if(all('payments').some(p=>p.invoiceId===i.id))fail('An invoice with payments cannot be cancelled.');put('invoices',{...i,status:'Cancelled'});}
    else if(b.action==='send'){if(!process.env.SMTP_HOST)fail('Configure SMTP to email invoices.',503);const c=all('customers').find(c=>c.id===i.customerId);await nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_PORT==='465',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined}).sendMail({from:process.env.MAIL_FROM,to:c.email,subject:`Invoice ${i.number}`,text:`Hello ${c.name},\nInvoice ${i.number}\nDue: ${i.due}\nSubtotal: $${i.subtotal}\nDiscount: $${i.discount}\nTax: $${i.tax}\nTotal: $${i.total}\nPlease sign in to your Subscript portal to view your invoice.`});}
    else fail('Invalid invoice action.');audit(u,`${b.action} invoice ${i.number}`);return send({ok:true});
  }
  if(path==='/api/convert'&&req.method==='POST'){
    const q=all('quotations').find(q=>q.id===b.id);if(!q)fail('Quotation not found.',404);if(q.subscriptionId)fail('This quotation has already been converted.');if(q.ends&&q.ends<new Date().toISOString().slice(0,10))fail('This quotation has expired.');
    const s={...q,id:uid(),number:`SUB-${uid().slice(0,8).toUpperCase()}`,status:'Confirmed',ends:''};validate('subscriptions',s);db.exec('BEGIN IMMEDIATE');try{put('subscriptions',s);put('quotations',{...q,status:'Confirmed',subscriptionId:s.id});db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}audit(u,'Converted quotation');return send(s);
  }
  if(path==='/api/billing'&&req.method==='POST'){const count=bill();audit(u,`Generated ${count} invoices`);return send({count});}
  if(path==='/api/staff'&&req.method==='POST'){if(u.role!=='admin')fail('Administrator access required.',403);if(!validPassword(b.password)||!/^\S+@\S+\.\S+$/.test(email)||!b.name?.trim())fail('Enter a name, valid email and a strong password.');if(db.prepare('SELECT id FROM users WHERE email=?').get(email))fail('Email already registered.');db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(uid(),b.name.trim(),email,passwordHash(b.password),'staff');audit(u,'Staff account created');return send({ok:true});}
  const match=path.match(/^\/api\/records\/([a-z]+)(?:\/([a-f0-9]+))?$/);if(!match||!types.includes(match[1]))fail('Not found',404);const [,type,id]=match;if(['products','plans','discounts','taxes'].includes(type)&&u.role!=='admin')fail('Administrator access required.',403);
  if(req.method==='POST'||req.method==='PATCH'){
    const old=id?all(type).find(r=>r.id===id):undefined;if(id&&!old)fail('Record not found.',404);let r={...old,...b,id:id||uid()};delete r.password;
    if(type==='invoices')fail('Invoices are generated from subscriptions. Use invoice actions.');
    if(type==='payments'){if(id)fail('Payments cannot be edited.');validate(type,r);const i=all('invoices').find(i=>i.id===r.invoiceId);if(!i||i.status==='Cancelled')fail('Choose a confirmed invoice.');const paid=all('payments').filter(p=>p.invoiceId===i.id).reduce((s,p)=>s+Number(p.amount),0);if(!(Number(r.amount)>0)||Number(r.amount)>i.total-paid+0.001)fail('Amount exceeds the outstanding balance or is invalid.');if(!r.date||!['Bank transfer','Card','Cash','Other'].includes(r.method))fail('Payment date and method are required.');db.exec('BEGIN IMMEDIATE');try{put(type,r);put('invoices',{...i,status:paid+Number(r.amount)>=i.total-0.001?'Paid':'Confirmed'});db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
    else {validate(type,r);if(type==='subscriptions'){if(old&&old.status==='Closed'&&r.status!=='Closed')fail('Renew a closed subscription as a new contract.');if(old&&all('invoices').some(i=>i.subscriptionId===id)&&['starts','customerId','productId','quantity','unitPrice','planId'].some(k=>String(old[k])!==String(r[k])))fail('Billed contract details cannot be changed. Create a new subscription for pricing changes.');r.nextBilling=old?.nextBilling||r.starts;}if(type==='customers'){if(r.assignedStaffId&&!db.prepare("SELECT id FROM users WHERE id=? AND role='staff'").get(r.assignedStaffId))fail('Choose a valid staff member.');const account=db.prepare('SELECT id FROM users WHERE email=? AND role=?').get(r.email,'customer');r.userId=account?.id||null;}if(type==='quotations'&&old?.subscriptionId)r.subscriptionId=old.subscriptionId;if(type==='discounts')r.used=old?.used||0;put(type,r);}audit(u,`${id?'Updated':'Created'} ${type}: ${r.id}`);return send(r);
  }
  if(req.method==='DELETE'){if(['payments','invoices','subscriptions'].includes(type))fail('Financial records are retained. Close or cancel them instead.');const references={customers:['customerId'],products:['productId'],plans:['planId'],discounts:['discountId'],taxes:['taxId']};if(types.some(t=>all(t).some(r=>(references[type]||[]).some(key=>r[key]===id))))fail('This record is in use and cannot be deleted.');db.prepare('DELETE FROM records WHERE id=? AND type=?').run(id,type);audit(u,`Deleted ${type}: ${id}`);return send({ok:true});}
  fail('Method not allowed',405);
}catch(e){send({error:e.code&&typeof e.code==='number'?e.message:'The request could not be completed.'},typeof e.code==='number'?e.code:500);if(!e.code)console.error(e);}});
server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log(`Subscript running at ${process.env.APP_URL||'http://localhost:3000'}`));
const timer=setInterval(()=>{try{bill();}catch(e){console.error('Billing error',e.message);}},60000);timer.unref();

server.on('close',()=>{clearInterval(timer);db.close();});
export {server};
