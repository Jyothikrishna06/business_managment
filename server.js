import {createExpiryMailer} from './expiry-mail.js';
import {createSoftwarePortal} from './software-server.js';
import {createExcelReport,reportSchema} from './excel-report.js';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import nodemailer from 'nodemailer';

const root = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(process.env.DATA_DIR || `${root}data`, { recursive: true });
const db = new DatabaseSync(`${process.env.DATA_DIR || `${root}data`}/subscript.db`);
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT,status TEXT DEFAULT 'active'); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,userId TEXT,expires INTEGER); CREATE TABLE IF NOT EXISTS resets(token TEXT PRIMARY KEY,userId TEXT,expires INTEGER); CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,type TEXT,body TEXT); CREATE INDEX IF NOT EXISTS records_type_idx ON records(type); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,time TEXT,userId TEXT,action TEXT); CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,userId TEXT,title TEXT,message TEXT,type TEXT,referenceId TEXT,createdAt TEXT,readAt TEXT,UNIQUE(userId,type,referenceId)); CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(userId,createdAt DESC); CREATE TABLE IF NOT EXISTS expiry_notices(id TEXT PRIMARY KEY,subscriptionId TEXT,stage TEXT,sentAt TEXT,UNIQUE(subscriptionId,stage)); CREATE TABLE IF NOT EXISTS otps(email TEXT PRIMARY KEY,code_hash TEXT,expires INTEGER,attempts INTEGER DEFAULT 0,purpose TEXT);`);
if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='status'))db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'");
const types = ['products','plans','customers','quotationTemplates','quotations','subscriptions','invoices','payments','discounts','taxes'];
const hash = v => createHash('sha256').update(v).digest('hex');
const uid = () => randomBytes(12).toString('hex');
const passwordHash = password => { const salt = uid(); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; };
const validPassword = p => typeof p === 'string' && p.length > 8 && p.length <= 128 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[^a-zA-Z0-9]/.test(p);
const publicUser = u => ({ id:u.id,name:u.name,email:u.email,role:u.role,status:u.status||'active' });
const all = type => db.prepare('SELECT body FROM records WHERE type=?').all(type).map(r=>JSON.parse(r.body));
const put = (type,r) => { db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?)').run(r.id,type,JSON.stringify(r)); return r; };
function fail(message,code=400){ throw Object.assign(new Error(message),{code}); }
function audit(user,action){ db.prepare('INSERT INTO audit(time,userId,action) VALUES(?,?,?)').run(new Date().toISOString(),user?.id||'system',action); }
function notify(userId,title,message,type,referenceId=''){if(!userId)return;db.prepare('INSERT OR IGNORE INTO notifications(id,userId,title,message,type,referenceId,createdAt,readAt) VALUES(?,?,?,?,?,?,?,NULL)').run(uid(),userId,title,message,type,referenceId,new Date().toISOString());}
function notifyRoles(title,message,type,referenceId){db.prepare("SELECT id FROM users WHERE role IN ('admin','staff') AND COALESCE(status,'active')='active'").all().forEach(({id})=>notify(id,title,message,type,referenceId));}
function customerUserId(customerId){return all('customers').find(c=>c.id===customerId)?.userId||null;}
function notifyQuotation(quote,event){const product=all('products').find(p=>p.id===quote.productId)?.name||'product';const customer=all('customers').find(c=>c.id===quote.customerId);const customerName=customer?.name||'Customer';if(event==='created'){notifyRoles('New quotation awaiting review',`${quote.number||'Quotation'} for ${customerName} · ${product} is ready for team review.`,'quotation-created',quote.id);notify(customer?.userId,'Quotation submitted',`${quote.number||'Quotation'} for ${product} was submitted and is awaiting confirmation.`,'quotation-created-customer',quote.id);}else if(event==='expiring'){notifyRoles('Quotation expires soon',`${quote.number||'Quotation'} for ${customerName} expires on ${quote.ends}.`,'quotation-expiring',quote.id);notify(customer?.userId,'Quotation expires soon',`${quote.number||'Quotation'} expires on ${quote.ends}. Contact Brightloop if you want to proceed.`,'quotation-expiring-customer',quote.id);}else if(event==='expired'){notifyRoles('Quotation expired',`${quote.number||'Quotation'} for ${customerName} expired on ${quote.ends}.`,'quotation-expired',quote.id);notify(customer?.userId,'Quotation expired',`${quote.number||'Quotation'} expired on ${quote.ends}. A new quotation can be requested.`,'quotation-expired-customer',quote.id);}else if(event==='converted'){notifyRoles('Quotation converted',`${quote.number||'Quotation'} for ${customerName} was converted to a subscription.`,'quotation-converted',quote.id);notify(customer?.userId,'Quotation approved',`${quote.number||'Quotation'} was approved and converted to a subscription.`,'quotation-converted-customer',quote.id);}}
function quotationAutomation(){const today=new Date().toISOString().slice(0,10),soon=new Date(`${today}T12:00:00Z`);soon.setUTCDate(soon.getUTCDate()+3);const soonDate=soon.toISOString().slice(0,10);for(const quote of all('quotations')){if(['Draft','Quotation'].includes(quote.status)&&quote.ends&&quote.ends<today){quote.status='Expired';put('quotations',quote);notifyQuotation(quote,'expired');}else if(['Draft','Quotation'].includes(quote.status)&&quote.ends===soonDate)notifyQuotation(quote,'expiring');}}
function ensureBootstrapAdmin(){
  const email=(process.env.BOOTSTRAP_ADMIN_EMAIL||'make_a_ton@gmail.com').trim().toLowerCase();
  const password=process.env.BOOTSTRAP_ADMIN_PASSWORD||'makeaton123';
  const existing=db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if(!existing) db.prepare('INSERT INTO users(id,name,email,password,role,status) VALUES(?,?,?,?,?,?)').run(uid(),'Make A Ton Admin',email,passwordHash(password),'admin','active');
}
ensureBootstrapAdmin();
const round=value=>Math.round(Number(value||0)*100)/100;
function recordLines(record){
  const supplied=Array.isArray(record.lines)&&record.lines.length?record.lines:[{productId:record.productId,planId:record.planId,variantId:record.variantId,variantName:record.variantName,quantity:record.quantity,unitPrice:record.unitPrice,taxId:record.taxId,discountId:record.discountId}];
  return supplied.map(line=>({...line,productId:line.productId||record.productId,planId:line.planId||record.planId,quantity:Number(line.quantity),unitPrice:Number(line.unitPrice),taxId:line.taxId??record.taxId??'',discountId:line.discountId??record.discountId??''}));
}
function calculate(s,date,context={}){
  const products=context.products||all('products'),taxes=context.taxes||all('taxes'),discounts=context.discounts||all('discounts'),lines=recordLines(s);
  const prepared=lines.map(line=>{const product=products.find(p=>p.id===line.productId);const subtotal=round(line.unitPrice*line.quantity);return {...line,name:(product?.name||'Subscription')+(line.variantName?' · '+line.variantName:''),subtotal};});
  const subtotal=round(prepared.reduce((sum,line)=>sum+line.subtotal,0));
  const discount=discounts.find(d=>d.id===s.discountId);
  const eligible=discount?.scope==='Product'&&discount.productId?prepared.filter(line=>line.productId===discount.productId):prepared;
  const eligibleSubtotal=round(eligible.reduce((sum,line)=>sum+line.subtotal,0)),eligibleQuantity=eligible.reduce((sum,line)=>sum+line.quantity,0);
  const applies=discount&&(discount.kind==='Percentage'||!discount.currency||discount.currency===(s.currency||'USD'))&&(!discount.starts||discount.starts<=date)&&(!discount.ends||discount.ends>=date)&&(!discount.limit||Number(discount.used||0)<Number(discount.limit))&&eligibleQuantity>=Number(discount.minQuantity||1)&&eligibleSubtotal>=Number(discount.minPurchase||0);
  let deduction=applies?(discount.kind==='Percentage'?eligibleSubtotal*Number(discount.value)/100:Number(discount.value)):0;deduction=round(Math.min(eligibleSubtotal,deduction));
  let remainingDiscount=deduction,eligibleRemaining=eligible.length;
  const invoiceLines=prepared.map(line=>{const eligibleLine=eligible.includes(line);let lineDiscount=0;if(eligibleLine&&deduction){eligibleRemaining--;lineDiscount=eligibleRemaining===0?remainingDiscount:round(deduction*(line.subtotal/Math.max(eligibleSubtotal,1)));lineDiscount=Math.min(line.subtotal,remainingDiscount,lineDiscount);remainingDiscount=round(remainingDiscount-lineDiscount);}const taxRule=taxes.find(t=>t.id===line.taxId);const tax=round((line.subtotal-lineDiscount)*Number(taxRule?.rate||0)/100);return {...line,discount:lineDiscount,tax,total:round(line.subtotal-lineDiscount+tax)};});
  const tax=round(invoiceLines.reduce((sum,line)=>sum+line.tax,0));
  return {subtotal,discount:deduction,tax,total:round(subtotal-deduction+tax),lines:invoiceLines};
}
function nextDate(date,cycle,anchor){ const d=new Date(`${date}T12:00:00Z`); const day=d.getUTCDate(); if(cycle==='Daily')d.setUTCDate(day+1);else if(cycle==='Weekly')d.setUTCDate(day+7);else {d.setUTCDate(1);if(cycle==='Yearly')d.setUTCFullYear(d.getUTCFullYear()+1);else d.setUTCMonth(d.getUTCMonth()+1);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(anchor||day,last));}return d.toISOString().slice(0,10); }
function bill(){
  const today=new Date().toISOString().slice(0,10),subscriptions=all('subscriptions'),plans=new Map(all('plans').map(item=>[item.id,item])),customers=new Map(all('customers').map(item=>[item.id,item])),invoices=all('invoices'),invoicePeriods=new Set(invoices.map(item=>`${item.subscriptionId}:${item.billingDate}`)),context={products:all('products'),taxes:all('taxes'),discounts:all('discounts')};let count=0;db.exec('BEGIN IMMEDIATE');
  try{for(const s of subscriptions){
    if(s.status!=='Active')continue;const plan=plans.get(s.planId);let due=s.nextBilling||s.starts;let n=0;
    while(due&&due<=today&&n++<120){
      if(s.ends&&due>s.ends){if(plan?.autoClose===true)s.status='Closed';break;}
      if(!invoicePeriods.has(`${s.id}:${due}`)){
        const totals=calculate(s,due,context),customer=customers.get(s.customerId);
        const dueDate=new Date(`${due}T12:00:00Z`);dueDate.setUTCDate(dueDate.getUTCDate()+Number(String(s.terms||'').match(/Net (7|15|30|60)/)?.[1]||0));
        put('invoices',{id:uid(),number:`INV-${uid().slice(0,8).toUpperCase()}`,customerId:s.customerId,subscriptionId:s.id,billingDate:due,due:dueDate.toISOString().slice(0,10),currency:s.currency||'USD',status:totals.total===0?'Paid':'Draft',line:totals.lines[0],lines:totals.lines,customer:{name:customer?.name||'Customer',email:customer?.email||''},terms:s.terms||'',...totals});invoicePeriods.add(`${s.id}:${due}`);count++;
        if(totals.discount&&s.discountId){const d=context.discounts.find(item=>item.id===s.discountId),updated={...d,used:Number(d.used||0)+1};put('discounts',updated);context.discounts=context.discounts.map(item=>item.id===updated.id?updated:item);}
      }
      due=nextDate(due,s.cycle||'Monthly',Number(s.starts.slice(8,10)));
    }
    if(plan?.autoClose===true&&s.ends&&s.ends<today&&due>s.ends)s.status='Closed';s.nextBilling=due;put('subscriptions',s);
  }db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return count;
}
const sendExpiryEmail=createExpiryMailer({db,all,uid,notify,notifyRoles,audit});
function subscriptionAutomation(){
  const today=new Date().toISOString().slice(0,10),plans=all('plans');
  for(const subscription of all('subscriptions')){
    if(!['Confirmed','Active','Paused'].includes(subscription.status)&&!(subscription.status==='Closed'&&subscription.closedReason==='Plan ended automatically'))continue;
    if(!subscription.ends)continue;
    const todayMs=new Date(`${today}T00:00:00Z`).getTime();
    const endMs=new Date(`${subscription.ends}T00:00:00Z`).getTime();
    const daysRemaining=Math.round((endMs-todayMs)/86400000);
    if(daysRemaining<=7&&daysRemaining>1)sendExpiryEmail(subscription,'week_before',daysRemaining).catch(e=>console.error('Expiry mail error',e.message));
    if(daysRemaining<=1&&daysRemaining>0)sendExpiryEmail(subscription,'day_before',daysRemaining).catch(e=>console.error('Expiry mail error',e.message));
    if(daysRemaining<=0&&daysRemaining>=-7)sendExpiryEmail(subscription,'on_expiry',daysRemaining).catch(e=>console.error('Expiry mail error',e.message));
    const plan=plans.find(p=>p.id===subscription.planId);
    if(subscription.status!=='Closed'&&plan?.autoClose===true&&daysRemaining<0){
      put('subscriptions',{...subscription,status:'Closed',closedReason:'Plan ended automatically'});
      notifyRoles('Subscription closed automatically',`${subscription.number||'Subscription'} reached its configured end date.`,'subscription-auto-closed',subscription.id);
      notify(customerUserId(subscription.customerId),'Subscription ended',`${subscription.number||'Your subscription'} reached its end date and was closed.`,'subscription-auto-closed-customer',subscription.id);
    }
  }
}
function assertSubscriptionTransition(previous,next){
  if(!previous||previous===next)return;const allowed={Draft:['Quotation','Confirmed','Closed'],Quotation:['Confirmed','Closed'],Confirmed:['Active','Closed'],Active:['Paused','Closed'],Paused:['Active','Closed'],Closed:[]};if(!allowed[previous]?.includes(next))fail(`Subscription cannot move from ${previous} to ${next}.`);
}
const attempts=new Map();
function throttle(key){const now=Date.now();const item=attempts.get(key)||{n:0,expires:now+900000};if(item.expires<now){item.n=0;item.expires=now+900000;}item.n++;attempts.set(key,item);if(item.n>30)fail('Too many attempts. Please try again in 15 minutes.',429);}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>100000)fail('Request too large',413);}try{return data?JSON.parse(data):{};}catch{fail('Invalid JSON');}}
function validate(type,r){
  if(['products','plans','customers','quotationTemplates','discounts','taxes'].includes(type)&&!String(r.name||'').trim())fail('Name is required.');
  for(const key of ['price','cost','quantity','unitPrice','value','rate','minQuantity','minPurchase','limit','amount','validDays'])if(r[key]!==undefined&&r[key]!==''&&(!Number.isFinite(Number(r[key]))||Number(r[key])<0||Number(r[key])>1e10))fail(`${key} must be a valid positive number.`);
  if(type==='customers'){if(!/^\S+@\S+\.\S+$/.test(r.email||''))fail('Enter a valid customer email.');r.email=r.email.toLowerCase().trim();}
  if(type==='products'){
    if(r.productType&&!['Software','Service','Add-on'].includes(r.productType))fail('Choose Software, Service or Add-on.');
    if(r.currency&&!['INR','USD'].includes(r.currency))fail('Choose a supported currency.');
    if(r.variants!==undefined){if(!Array.isArray(r.variants)||!r.variants.length||r.variants.length>20)fail('Add between 1 and 20 variants.');const ids=new Set();r.variants=r.variants.map(v=>{if(typeof v.name!=='string'||!v.name.trim()||v.name.length>100||!Number.isFinite(Number(v.extraPrice))||Number(v.extraPrice)<0||Number(v.extraPrice)>1e10)fail('Enter a variant name and valid extra price.');const id=String(v.id||uid());if(ids.has(id))fail('Variant IDs must be unique.');ids.add(id);return {id,name:v.name.trim(),extraPrice:Number(v.extraPrice)};});}
  }
  if(type==='plans'){
    if(r.productId&&!all('products').some(p=>p.id===r.productId))fail('Choose a product.');
    if(r.currency&&!['INR','USD'].includes(r.currency))fail('Choose a supported currency.');
    for(const key of ['allowPause','allowClose','allowRenew','autoClose'])if(r[key]!==undefined){if(r[key]==='')r[key]=false;if(![true,false,'true','false'].includes(r[key]))fail('Choose a valid plan permission.');r[key]=r[key]===true||r[key]==='true';}
    if(r.variantMultiplier==='')r.variantMultiplier=1;
    for(const [key,type] of [['taxId','taxes'],['discountId','discounts']])if(r[key]&&!all(type).some(t=>t.id===r[key]))fail('Choose valid tax and discount rules.');
    if(r.variantMultiplier!==undefined&&(!Number.isFinite(Number(r.variantMultiplier))||Number(r.variantMultiplier)<0||Number(r.variantMultiplier)>366))fail('Choose a valid variant billing multiplier.');
  }
  if(type==='plans'&&!['Daily','Weekly','Monthly','Yearly'].includes(r.cycle))fail('Choose a billing cycle.');
  if(type==='discounts'&&!['Fixed','Percentage'].includes(r.kind))fail('Choose a discount type.');
  if(type==='discounts'){r.scope=r.scope||'Subscription';if(!['Subscription','Product'].includes(r.scope))fail('Choose a valid discount scope.');if(r.scope==='Product'&&!all('products').some(p=>p.id===r.productId))fail('Choose the product this discount applies to.');if(r.scope==='Subscription')r.productId='';if(r.currency&&!['INR','USD'].includes(r.currency))fail('Choose INR or USD.');}
  if(type==='taxes'&&Number(r.rate)>100)fail('Tax rate cannot exceed 100%.');
  if(type==='discounts'&&r.kind==='Percentage'&&Number(r.value)>100)fail('Discount cannot exceed 100%.');
  for(const key of ['starts','ends','due','date'])if(r[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(r[key])||!Number.isFinite(Date.parse(r[key]))))fail('Enter valid dates.');
  if(r.starts&&r.ends&&r.ends<r.starts)fail('End date must follow start date.');
  if(['subscriptions','quotations','quotationTemplates'].includes(type)){
    if(type==='quotationTemplates'){if(!Number.isInteger(Number(r.validDays))||Number(r.validDays)<1||Number(r.validDays)>365)fail('Template validity must be between 1 and 365 days.');r.starts=r.starts||new Date().toISOString().slice(0,10);}
    else if(!all('customers').some(c=>c.id===r.customerId))fail('Choose a customer.');
    let prod=all('products').find(p=>p.id===r.productId||p.key===r.productId||(r.productId&&p.name.trim().toLowerCase()===String(r.productId).trim().toLowerCase()));
    if(!prod&&r.planId){const pl=all('plans').find(p=>p.id===r.planId);if(pl?.productId)prod=all('products').find(p=>p.id===pl.productId);}
    if(!prod)fail('Choose a product.');r.productId=prod.id;
    const plan=all('plans').find(c=>c.id===r.planId);if(!plan)fail('Choose a plan.');
    if(!Number.isFinite(Number(r.unitPrice))||!Number.isInteger(Number(r.quantity))||Number(r.quantity)<Math.max(1,Number(plan.minQuantity||1)))fail('Enter a valid price and a whole quantity above the plan minimum.');
    if((plan.starts&&r.starts<plan.starts)||(plan.ends&&r.starts>plan.ends))fail('The plan is unavailable on this start date.');
    if(r.taxId&&!all('taxes').some(t=>t.id===r.taxId))fail('Choose a valid tax rule.');
    if(r.discountId&&!all('discounts').some(t=>t.id===r.discountId))fail('Choose a valid discount.');
    if(!r.starts)fail('Start date is required.');r.cycle=plan.cycle;
    const rawLines=Array.isArray(r.lines)&&r.lines.length?r.lines:[{productId:r.productId,planId:r.planId,variantId:r.variantId,variantName:r.variantName,quantity:r.quantity,unitPrice:r.unitPrice,taxId:r.taxId||'',discountId:r.discountId||''}];if(rawLines.length>25)fail('Use no more than 25 product lines.');r.lines=rawLines.map((line,index)=>{const linePlan=all('plans').find(p=>p.id===(line.planId||r.planId)),lineProduct=all('products').find(p=>p.id===(line.productId||linePlan?.productId));if(!linePlan||!lineProduct)fail(`Choose a valid product and plan for line ${index+1}.`);const quantity=Number(line.quantity),unitPrice=Number(line.unitPrice);if(!Number.isInteger(quantity)||quantity<Math.max(1,Number(linePlan.minQuantity||1))||!Number.isFinite(unitPrice)||unitPrice<0)fail(`Enter valid pricing for line ${index+1}.`);if((linePlan.starts&&r.starts<linePlan.starts)||(linePlan.ends&&r.starts>linePlan.ends))fail(`The plan on line ${index+1} is unavailable on this start date.`);if(line.taxId&&!all('taxes').some(t=>t.id===line.taxId))fail(`Choose a valid tax for line ${index+1}.`);return {id:line.id||uid(),productId:lineProduct.id,planId:linePlan.id,variantId:line.variantId||'',variantName:String(line.variantName||''),quantity,unitPrice,taxId:line.taxId||'',discountId:line.discountId||''};});
    const primary=r.lines[0];Object.assign(r,{productId:primary.productId,planId:primary.planId,variantId:primary.variantId,variantName:primary.variantName,quantity:primary.quantity,unitPrice:primary.unitPrice,taxId:r.taxId||primary.taxId||'',discountId:r.discountId||primary.discountId||''});
    if(type==='subscriptions'&&!['Draft','Quotation','Confirmed','Active','Paused','Closed'].includes(r.status))fail('Invalid status.');
  }
}
/* --- OTP helpers (customer-only password flows) --- */
const OTP_TTL = 600000; /* 10 minutes */
const OTP_MAX_ATTEMPTS = 5;
function generateOtp() { return String(randomInt(100000,1000000)); }
async function sendOtpMail(toEmail, otp, purpose) {
  const subject = purpose === 'reset' ? 'Your Brightloop password reset code' : 'Your Brightloop password change code';
  const text = `Your verification code is: ${otp}\n\nIt expires in 10 minutes. Do not share it with anyone.\nIf you did not request this, ignore this email.`;
  if (process.env.SMTP_HOST) {
    await nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_PORT === '465', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined }).sendMail({ from: process.env.MAIL_FROM, to: toEmail, subject, text });
  } else if(process.env.DEV_RESET_LINKS==='true') {
    console.log(`[DEV] OTP for ${toEmail} (${purpose}): ${otp}`);
  } else {fail('Email delivery is not configured. Contact your administrator.',503);}
}
function storeOtp(email, otp, purpose) {
  db.prepare('INSERT OR REPLACE INTO otps(email,code_hash,expires,attempts,purpose) VALUES(?,?,?,0,?)').run(email, hash(otp), Date.now() + OTP_TTL, purpose);
}
function verifyOtp(email, code, purpose) {
  const row = db.prepare('SELECT * FROM otps WHERE email=? AND purpose=?').get(email, purpose);
  if (!row) fail('No OTP was requested for this email, or it has expired. Please request a new code.');
  if (row.expires < Date.now()) { db.prepare('DELETE FROM otps WHERE email=?').run(email); fail('The code has expired. Please request a new code.'); }
  if (row.attempts >= OTP_MAX_ATTEMPTS) { db.prepare('DELETE FROM otps WHERE email=?').run(email); fail('Too many incorrect attempts. Please request a new code.'); }
  if (!timingSafeEqual(Buffer.from(hash(String(code)), 'hex'), Buffer.from(row.code_hash, 'hex'))) {
    db.prepare('UPDATE otps SET attempts=attempts+1 WHERE email=?').run(email);
    fail('The code is incorrect. Please check your email and try again.');
  }
  db.prepare('DELETE FROM otps WHERE email=?').run(email);
}
/* -------------------------------------------------- */
const softwarePortal=createSoftwarePortal({all,put,uid,fail,audit,nextDate,calculate,db,notifyQuotation});
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');const path=url.pathname;const send=(data,code=200,headers={})=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));};try{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  if(!path.startsWith('/api/')){const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/customer-portal.js':'customer-portal.js','/styles.css':'styles.css','/theme.css':'theme.css'};if(files[path]){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(`${root}${files[path]}`));return;}if(path.startsWith('/assets/')){const assetRoot=resolve(root,'assets'),assetPath=resolve(root,`.${decodeURIComponent(path)}`);if(!assetPath.startsWith(`${assetRoot}${sep}`)||!existsSync(assetPath))return send({error:'Not found'},404);const mime={'.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg'}[extname(assetPath).toLowerCase()];if(!mime)return send({error:'Unsupported asset type'},415);res.setHeader('Content-Type',mime);res.setHeader('Cache-Control','public, max-age=3600');res.end(readFileSync(assetPath));return;}return send({error:'Not found'},404);}
  if(req.method!=='GET' && req.headers.origin && req.headers.origin!==`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`)fail('Invalid request origin.',403);
  const b=req.method==='GET'?{}:await body(req);const email=String(b.email||'').trim().toLowerCase();
  if(path==='/api/auth/register'&&req.method==='POST'){
    throttle(req.socket.remoteAddress);if(!b.name?.trim()||!/^\S+@\S+\.\S+$/.test(email))fail('Enter your name and a valid email.');if(!validPassword(b.password))fail('Use more than 8 characters with uppercase, lowercase and a special character.');
    if(db.prepare('SELECT id FROM users WHERE email=?').get(email))fail('An account already exists with this email.');
    const role='customer';const u={id:uid(),name:b.name.trim(),email,password:passwordHash(b.password),role};db.prepare('INSERT INTO users(id,name,email,password,role,status) VALUES(?,?,?,?,?,?)').run(u.id,u.name,email,u.password,role,'active');put('customers',{id:uid(),name:u.name,email,userId:u.id});audit(u,'Customer account registered');return send({ok:true});
  }
  if(path==='/api/auth/login'&&req.method==='POST'){
    throttle(req.socket.remoteAddress);const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);const [salt,saved]=(u?.password||`${uid()}:${'0'.repeat(128)}`).split(':');const computed=scryptSync(String(b.password||''),salt,64);if(!u||!timingSafeEqual(computed,Buffer.from(saved,'hex')))fail('Email or password is incorrect.',401);if(u.status==='deactivated')fail('This account has been deactivated. Contact your administrator.',403);
    const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),u.id,Date.now()+86400000);return send({user:publicUser(u)},200,{'Set-Cookie':`session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${process.env.APP_URL?.startsWith('https')?'; Secure':''}`});
  }
  if(path==='/api/auth/forgot'&&req.method==='POST'){
    throttle(req.socket.remoteAddress);const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if(!process.env.SMTP_HOST && process.env.DEV_RESET_LINKS!=='true')fail('Email delivery is not configured. Contact your administrator.',503);
    if(u){const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM resets WHERE userId=?').run(u.id);db.prepare('INSERT INTO resets VALUES(?,?,?)').run(hash(token),u.id,Date.now()+1800000);const link=`${process.env.APP_URL||'http://localhost:3000'}/?reset=${token}`;if(process.env.SMTP_HOST){await nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_PORT==='465',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined}).sendMail({from:process.env.MAIL_FROM,to:email,subject:'Reset your Subscript password',text:`Reset your password using this link (expires in 30 minutes):\n${link}\nIf you did not request this, ignore this email.`});}else console.log(`Local password reset for ${email}: ${link}`);}
    return send({message:'If an account exists, a password reset link has been requested. It expires in 30 minutes.'});
  }
  if(path==='/api/auth/reset'&&req.method==='POST'){
    throttle(req.socket.remoteAddress);if(!validPassword(b.password))fail('Use more than 8 characters with uppercase, lowercase and a special character.');const r=db.prepare('SELECT * FROM resets WHERE token=? AND expires>?').get(hash(String(b.token)),Date.now());if(!r)fail('This link is invalid or expired. Request a new reset link.');db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(b.password),r.userId);db.prepare('DELETE FROM resets WHERE userId=?').run(r.userId);db.prepare('DELETE FROM sessions WHERE userId=?').run(r.userId);const resetUser=db.prepare('SELECT email FROM users WHERE id=?').get(r.userId);if(resetUser)db.prepare('DELETE FROM otps WHERE email=?').run(resetUser.email);return send({ok:true});
  }
  
  /* ---- OTP: send code for forgot-password (customers only) ---- */
  if(path==='/api/auth/otp/send'&&req.method==='POST'){
    throttle(req.socket.remoteAddress);
    if(!email)fail('Enter your email address.');
    const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);
    
    if(!process.env.SMTP_HOST&&process.env.DEV_RESET_LINKS!=='true')fail('Email delivery is not configured. Contact your administrator.',503);
    if(u?.role==='customer'){const otp=generateOtp();storeOtp(email,otp,'reset');try{await sendOtpMail(email,otp,'reset');}catch(error){db.prepare('DELETE FROM otps WHERE email=?').run(email);throw error;}}
    return send({message:'If a customer account exists for that email, a 6-digit code has been sent. It expires in 10 minutes.'});
  }
  /* ---- OTP: verify code and set new password (forgot flow) ---- */
  if(path==='/api/auth/otp/reset'&&req.method==='POST'){
    throttle(req.socket.remoteAddress);
    if(!email)fail('Enter your email address.');
    if(!validPassword(b.password))fail('Use more than 8 characters with uppercase, lowercase and a special character.');
    const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if(!u||u.role!=='customer')fail('The code is invalid or expired.');
    verifyOtp(email,String(b.otp||''),'reset');
    db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(b.password),u.id);
    db.prepare('DELETE FROM sessions WHERE userId=?').run(u.id);db.prepare('DELETE FROM resets WHERE userId=?').run(u.id);
    audit(u,'Customer reset password via OTP');
    return send({ok:true});
  }
  const token=(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('session='))?.slice(8);const session=token&&db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(hash(token),Date.now());const u=session&&db.prepare('SELECT * FROM users WHERE id=?').get(session.userId);if(!u)fail('Please sign in.',401);if(u.status==='deactivated')fail('This account has been deactivated.',403);
  if(path==='/api/auth/me'&&req.method==='GET')return send({user:publicUser(u)});
  /* ---- OTP: send code for change-password (logged-in customers only) ---- */
  if(path==='/api/auth/otp/change/send'&&req.method==='POST'){
    if(u.role!=='customer')fail('This action is available for customer accounts only.',403);
    throttle(u.id);
    if(!process.env.SMTP_HOST&&process.env.DEV_RESET_LINKS!=='true')fail('Email delivery is not configured. Contact your administrator.',503);const otp=generateOtp();storeOtp(u.email,otp,'change');try{await sendOtpMail(u.email,otp,'change');}catch(error){db.prepare('DELETE FROM otps WHERE email=?').run(u.email);throw error;}
    return send({message:'A 6-digit code has been sent to your registered email. It expires in 10 minutes.'});
  }
  /* ---- OTP: verify code and update password (change flow) ---- */
  if(path==='/api/auth/otp/change'&&req.method==='POST'){
    if(u.role!=='customer')fail('This action is available for customer accounts only.',403);
    throttle(u.id);
    if(!validPassword(b.password))fail('Use more than 8 characters with uppercase, lowercase and a special character.');
    verifyOtp(u.email,String(b.otp||''),'change');
    db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(b.password),u.id);
    db.prepare('DELETE FROM sessions WHERE userId=? AND token<>?').run(u.id,hash(token));db.prepare('DELETE FROM resets WHERE userId=?').run(u.id);
    audit(u,'Customer changed password via OTP');
    return send({ok:true});
  }
  if(path==='/api/auth/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));return send({ok:true},200,{'Set-Cookie':'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});}
  if(path==='/api/profile'&&req.method==='POST'){if(!b.name?.trim())fail('Name is required.');db.prepare('UPDATE users SET name=? WHERE id=?').run(b.name.trim(),u.id);for(const cust of all('customers').filter(c=>c.userId===u.id))put('customers',{...cust,name:b.name.trim()});audit(u,'Updated profile name');return send({user:{...publicUser(u),name:b.name.trim()}});}
  if(path==='/api/notifications'&&req.method==='GET'){quotationAutomation();const items=db.prepare('SELECT id,title,message,type,referenceId,createdAt,readAt FROM notifications WHERE userId=? ORDER BY createdAt DESC LIMIT 30').all(u.id);return send({items,unread:db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE userId=? AND readAt IS NULL').get(u.id).n});}
  if(path==='/api/notifications/all'&&req.method==='POST'){db.prepare('UPDATE notifications SET readAt=? WHERE userId=? AND readAt IS NULL').run(new Date().toISOString(),u.id);return send({ok:true});}
  const notificationMatch=path.match(/^\/api\/notifications\/([a-f0-9]+)\/read$/);if(notificationMatch&&req.method==='POST'){const item=db.prepare('SELECT id FROM notifications WHERE id=? AND userId=?').get(notificationMatch[1],u.id);if(!item)fail('Notification not found.',404);db.prepare('UPDATE notifications SET readAt=COALESCE(readAt,?) WHERE id=? AND userId=?').run(new Date().toISOString(),notificationMatch[1],u.id);return send({ok:true});}
  if(path==='/api/state'&&req.method==='GET'){subscriptionAutomation();const data=Object.fromEntries(types.map(t=>[t,all(t)]));if(u.role==='staff')data.products=data.products.map(({cost,...p})=>p);if(u.role==='customer'){data.demoCheckout=process.env.ENABLE_DEMO_CHECKOUT==='true';data.catalog=softwarePortal.catalog();const ids=data.customers.filter(c=>c.userId===u.id).map(c=>c.id);for(const t of ['subscriptions','quotations','invoices'])data[t]=data[t].filter(r=>ids.includes(r.customerId));const invoices=data.invoices.map(i=>i.id);data.payments=data.payments.filter(p=>invoices.includes(p.invoiceId));data.customers=data.customers.filter(c=>ids.includes(c.id));const ownedProductIds=new Set(data.subscriptions.flatMap(s=>recordLines(s).map(line=>line.productId)));data.products=data.products.filter(p=>ownedProductIds.has(p.id)).map(({id,name,price,currency})=>({id,name,price,currency}));data.quotationTemplates=[];data.discounts=[];data.taxes=[];}return send(data);}
  if(path.startsWith('/api/customer/'))return send(softwarePortal.handle(u,path,req.method,b));
  if(u.role==='customer')fail('You do not have permission to perform this action.',403);
  if(path==='/api/reports/schema'&&req.method==='GET')return send(reportSchema());
  if(path==='/api/reports/xlsx'&&req.method==='POST'){
    const records=Object.fromEntries(types.map(type=>[type,all(type)]));if(u.role==='staff')records.products=records.products.map(({cost,...p})=>p);
    const report=await createExcelReport(b,records,publicUser(u));
    audit(u,`Exported ${b.dataset} report with ${report.count} records`);
    res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${report.filename}"`,'Content-Length':report.buffer.length,'Cache-Control':'no-store','X-Report-Count':String(report.count)});
    res.end(report.buffer);return;
  }
  if(path==='/api/team'&&req.method==='GET'){if(u.role!=='admin')fail('Administrator access required.',403);return send(db.prepare("SELECT id,name,email,role,COALESCE(status,'active') as status FROM users WHERE role IN ('admin','staff')").all());}
  if(path==='/api/admin/customers'&&req.method==='GET'){if(u.role!=='admin')fail('Administrator access required.',403);return send(db.prepare("SELECT id,name,email,role,COALESCE(status,'active') as status FROM users WHERE role='customer'").all());}
  const linkMatch=path.match(/^\/api\/admin\/customers\/([a-f0-9]+)\/link$/);if(linkMatch&&req.method==='POST'){if(u.role!=='admin')fail('Administrator access required.',403);const account=db.prepare("SELECT * FROM users WHERE id=? AND role='customer'").get(linkMatch[1]),customer=all('customers').find(c=>c.id===b.customerId);if(!account||!customer)fail('Choose a valid customer account and billing record.',404);if(customer.email.toLowerCase()!==account.email.toLowerCase())fail('The account and billing record email addresses must match.');if(customer.userId&&customer.userId!==account.id)fail('This billing record is linked to another account.');put('customers',{...customer,userId:account.id});for(const duplicate of all('customers').filter(c=>c.id!==customer.id&&c.userId===account.id)){const used=['subscriptions','quotations'].some(type=>all(type).some(record=>record.customerId===duplicate.id));if(!used)db.prepare("DELETE FROM records WHERE id=? AND type='customers'").run(duplicate.id);}audit(u,`Linked customer account ${account.email}`);return send({ok:true});}
  if(path==='/api/admin/stats'&&req.method==='GET'){if(u.role!=='admin')fail('Administrator access required.',403);const subs=all('subscriptions'),invs=all('invoices'),pays=all('payments'),custs=all('customers');const active=subs.filter(s=>s.status==='Active');const mrr=active.reduce((sum,s)=>sum+recordLines(s).reduce((lineSum,line)=>lineSum+line.unitPrice*line.quantity,0)*({Daily:30.4375,Weekly:52/12,Monthly:1,Yearly:1/12}[s.cycle]||1),0);const totalRevenue=pays.reduce((s,p)=>s+Number(p.amount),0);const owed=invs.filter(i=>i.status!=='Cancelled').reduce((s,i)=>{const paid=pays.filter(p=>p.invoiceId===i.id).reduce((a,p)=>a+Number(p.amount),0);return s+Math.max(0,Number(i.total)-paid);},0);const today=new Date().toISOString().slice(0,10);const overdue=invs.filter(i=>i.status!=='Paid'&&i.status!=='Cancelled'&&i.due<today);const staffCount=db.prepare("SELECT COUNT(*) as c FROM users WHERE role='staff' AND COALESCE(status,'active')='active'").get().c;const customerCount=custs.length;return send({mrr,totalRevenue,owed,activeSubscriptions:active.length,totalSubscriptions:subs.length,overdueInvoices:overdue.length,overdueAmount:overdue.reduce((s,i)=>{const paid=pays.filter(p=>p.invoiceId===i.id).reduce((a,p)=>a+Number(p.amount),0);return s+Math.max(0,Number(i.total)-paid);},0),totalInvoices:invs.length,paidInvoices:invs.filter(i=>i.status==='Paid').length,totalPayments:pays.length,totalCustomers:customerCount,staffCount,planCount:all('plans').length,productCount:all('products').length});}
  if(path==='/api/admin/audit'&&req.method==='GET'){if(u.role!=='admin')fail('Administrator access required.',403);const rows=db.prepare('SELECT audit.id,audit.time,audit.action,users.name as userName,users.email as userEmail FROM audit LEFT JOIN users ON audit.userId=users.id ORDER BY audit.id DESC LIMIT 50').all();return send(rows);}
  const staffMatch=path.match(/^\/api\/(staff|users)\/([a-f0-9]+)(?:\/(deactivate|activate|reset))?$/);
  if(staffMatch&&req.method==='POST'){if(u.role!=='admin')fail('Administrator access required.',403);const [,userType,staffId,staffAction]=staffMatch;const target=db.prepare('SELECT * FROM users WHERE id=?').get(staffId);if(!target||(userType==='staff'&&!['staff','admin'].includes(target.role)))fail('User not found.',404);
    if(staffAction==='deactivate'){if(target.id===u.id)fail('You cannot deactivate your own account.');db.prepare("UPDATE users SET status='deactivated' WHERE id=?").run(staffId);db.prepare('DELETE FROM sessions WHERE userId=?').run(staffId);audit(u,`Deactivated ${target.email}`);return send({ok:true});}
    if(staffAction==='activate'){db.prepare("UPDATE users SET status='active' WHERE id=?").run(staffId);audit(u,`Reactivated ${target.email}`);return send({ok:true});}
    if(staffAction==='reset'){if(!validPassword(b.password))fail('Use more than 8 characters with uppercase, lowercase and a special character.');db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(b.password),staffId);db.prepare('DELETE FROM sessions WHERE userId=?').run(staffId);db.prepare('DELETE FROM resets WHERE userId=?').run(staffId);db.prepare('DELETE FROM otps WHERE email=?').run(target.email);audit(u,`Reset password for ${target.email}`);return send({ok:true});}
    if(!b.name?.trim())fail('Name is required.');if(b.email){const trimmed=b.email.trim().toLowerCase();if(trimmed!==target.email){if(db.prepare('SELECT id FROM users WHERE email=?').get(trimmed))fail('Email already registered.');}db.prepare('UPDATE users SET name=?,email=? WHERE id=?').run(b.name.trim(),trimmed,staffId);}else{db.prepare('UPDATE users SET name=? WHERE id=?').run(b.name.trim(),staffId);}audit(u,`Updated user ${target.email}`);return send({ok:true});
  }
  if(path==='/api/invoice-action'&&req.method==='POST'){
    const i=all('invoices').find(i=>i.id===b.id);if(!i)fail('Invoice not found.',404);
    if(b.action==='confirm'){if(i.status!=='Draft')fail('Only a draft invoice can be confirmed.');put('invoices',{...i,status:'Confirmed',confirmedAt:new Date().toISOString()});notify(customerUserId(i.customerId),'Invoice confirmed',`${i.number} is confirmed and due on ${i.due}.`,'invoice-confirmed-customer',i.id);}
    else if(b.action==='cancel'){if(!['Draft','Confirmed'].includes(i.status))fail('Only an unpaid invoice can be cancelled.');if(all('payments').some(p=>p.invoiceId===i.id))fail('An invoice with payments cannot be cancelled.');put('invoices',{...i,status:'Cancelled'});}
    else if(b.action==='send'){if(!['Confirmed','Paid'].includes(i.status))fail('Confirm this invoice before sending it.');if(!process.env.SMTP_HOST)fail('Configure SMTP to email invoices.',503);const c=all('customers').find(c=>c.id===i.customerId);if(!c)fail('Invoice customer not found.',404);const currency=i.currency||'USD';const formatAmount=value=>new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:2}).format(Number(value||0));await nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_PORT==='465',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined}).sendMail({from:process.env.MAIL_FROM,to:c.email,subject:`Invoice ${i.number}`,text:`Hello ${c.name},\nInvoice ${i.number}\nDue: ${i.due}\nSubtotal: ${formatAmount(i.subtotal)}\nDiscount: ${formatAmount(i.discount)}\nTax: ${formatAmount(i.tax)}\nTotal: ${formatAmount(i.total)}\nPlease sign in to your Brightloop portal to view your invoice.`});}
    else fail('Invalid invoice action.');audit(u,`${b.action} invoice ${i.number}`);return send({ok:true});
  }
  if(path==='/api/convert'&&req.method==='POST'){
    const q=all('quotations').find(q=>q.id===b.id);if(!q)fail('Quotation not found.',404);if(q.subscriptionId)fail('This quotation has already been converted.');if(q.ends&&q.ends<new Date().toISOString().slice(0,10))fail('This quotation has expired.');
    const source=q.sourceSubscriptionId&&all('subscriptions').find(s=>s.id===q.sourceSubscriptionId&&s.customerId===q.customerId);if(q.sourceSubscriptionId&&(!source||source.status!=='Draft'))fail('The requested subscription is no longer awaiting confirmation.');const s={...q,...(source||{}),id:source?.id||uid(),number:source?.number||`SUB-${uid().slice(0,8).toUpperCase()}`,status:'Confirmed',ends:q.subscriptionEnds||'',nextBilling:q.starts};delete s.sourceSubscriptionId;validate('subscriptions',s);db.exec('BEGIN IMMEDIATE');try{put('subscriptions',s);put('quotations',{...q,status:'Confirmed',subscriptionId:s.id});db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}notifyQuotation(q,'converted');audit(u,'Converted quotation');return send(s);
  }
  if(path==='/api/billing'&&req.method==='POST'){const count=bill();audit(u,`Generated ${count} invoices`);return send({count});}
  if(path==='/api/staff'&&req.method==='POST'){if(u.role!=='admin')fail('Administrator access required.',403);if(!validPassword(b.password)||!/^\S+@\S+\.\S+$/.test(email)||!b.name?.trim())fail('Enter a name, valid email and a strong password.');if(db.prepare('SELECT id FROM users WHERE email=?').get(email))fail('Email already registered.');db.prepare('INSERT INTO users(id,name,email,password,role,status) VALUES(?,?,?,?,?,?)').run(uid(),b.name.trim(),email,passwordHash(b.password),'staff','active');audit(u,'Staff account created');return send({ok:true});}
  const listMatch=path.match(/^\/api\/records\/([A-Za-z]+)$/);if(listMatch&&req.method==='GET'&&types.includes(listMatch[1])){const page=Math.max(1,Number(url.searchParams.get('page')||1)),limit=Math.min(200,Math.max(1,Number(url.searchParams.get('limit')||50))),offset=(page-1)*limit,total=db.prepare('SELECT COUNT(*) AS count FROM records WHERE type=?').get(listMatch[1]).count,items=db.prepare('SELECT body FROM records WHERE type=? ORDER BY rowid DESC LIMIT ? OFFSET ?').all(listMatch[1],limit,offset).map(row=>JSON.parse(row.body));if(!Number.isInteger(page)||!Number.isInteger(limit))fail('Use whole page and limit values.');return send({items:u.role==='staff'&&listMatch[1]==='products'?items.map(({cost,...p})=>p):items,page,limit,total,pages:Math.ceil(total/limit)});}
  const match=path.match(/^\/api\/records\/([A-Za-z]+)(?:\/([a-f0-9]+))?$/);if(!match||!types.includes(match[1]))fail('Not found',404);const [,type,id]=match;if(['products','plans','discounts','taxes'].includes(type)&&u.role!=='admin')fail('Administrator access required.',403);
  if(req.method==='POST'||req.method==='PATCH'){
    const old=id?all(type).find(r=>r.id===id):undefined;if(id&&!old)fail('Record not found.',404);let r={...old,...b,id:id||uid()};delete r.password;
    if(type==='invoices')fail('Invoices are generated from subscriptions. Use invoice actions.');
    if(type==='subscriptions'&&old&&all('invoices').some(i=>i.subscriptionId===id)&&['starts','customerId','productId','planId','quantity','unitPrice','lines'].some(key=>b[key]!==undefined&&JSON.stringify(b[key])!==JSON.stringify(old[key])))fail('Billed contract details cannot be changed. Create a new subscription for pricing changes.');
    if(type==='payments'){if(Math.abs(Number(r.amount)*100-Math.round(Number(r.amount)*100))>0.00001)fail('Use at most two decimal places for a payment.');if(r.date>new Date().toISOString().slice(0,10))fail('Payment date cannot be in the future.');if(id)fail('Payments cannot be edited.');validate(type,r);const i=all('invoices').find(i=>i.id===r.invoiceId);if(!i||i.status!=='Confirmed')fail('Choose a confirmed unpaid invoice.');const paid=all('payments').filter(p=>p.invoiceId===i.id).reduce((s,p)=>s+Number(p.amount),0);if(!(Number(r.amount)>0)||Number(r.amount)>i.total-paid+0.001)fail('Amount exceeds the outstanding balance or is invalid.');if(!r.date||!['Bank transfer','Card','Cash','Other'].includes(r.method))fail('Payment date and method are required.');db.exec('BEGIN IMMEDIATE');try{put(type,r);put('invoices',{...i,status:paid+Number(r.amount)>=i.total-0.001?'Paid':'Confirmed'});db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
    else {validate(type,r);if(type==='subscriptions'){assertSubscriptionTransition(old?.status,r.status);if(old&&all('invoices').some(i=>i.subscriptionId===id)&&['starts','customerId','lines'].some(k=>JSON.stringify(old[k])!==JSON.stringify(r[k])))fail('Billed contract details cannot be changed. Create a new subscription for pricing changes.');if(old&&old.status==='Paused'&&r.status==='Active'){let due=r.nextBilling||r.starts;const today=new Date().toISOString().slice(0,10);while(due<today)due=nextDate(due,r.cycle||'Monthly',Number(r.starts.slice(8,10)));r.nextBilling=due;}else{r.nextBilling=old?.nextBilling||r.starts;}}if(type==='customers'&&u.role==='staff'){r.userId=old?.userId||null;}else if(type==='customers'){const account=db.prepare('SELECT id FROM users WHERE email=? AND role=?').get(r.email,'customer');r.userId=account?.id||null;}if(type==='quotations'&&old?.subscriptionId)fail('Converted quotations cannot be edited.');if(type==='discounts')r.used=old?.used||0;put(type,r);if(type==='quotations'&&!id)notifyQuotation(r,'created');}audit(u,`${id?'Updated':'Created'} ${type}: ${r.id}`);return send(r);
  }
  if(req.method==='DELETE'){if(['payments','invoices','subscriptions'].includes(type))fail('Financial records are retained. Close or cancel them instead.');const references={customers:['customerId'],products:['productId'],plans:['planId'],discounts:['discountId'],taxes:['taxId']};if(types.some(t=>all(t).some(r=>(references[type]||[]).some(key=>r[key]===id))))fail('This record is in use and cannot be deleted.');db.prepare('DELETE FROM records WHERE id=? AND type=?').run(id,type);audit(u,`Deleted ${type}: ${id}`);return send({ok:true});}
  fail('Method not allowed',405);
}catch(e){send({error:e.code&&typeof e.code==='number'?e.message:'The request could not be completed.'},typeof e.code==='number'?e.code:500);if(!e.code)console.error(e);}});
server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log(`Subscript running at ${process.env.APP_URL||'http://localhost:3000'}`));
const timer=setInterval(()=>{try{bill();subscriptionAutomation();quotationAutomation();}catch(e){console.error('Scheduled automation error',e.message);}},60000);timer.unref();

server.on('close',()=>{clearInterval(timer);sendExpiryEmail.close();db.close();});
export {server,sendExpiryEmail,subscriptionAutomation,db};
