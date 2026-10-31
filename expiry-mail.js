import nodemailer from 'nodemailer';
import {createHash} from 'node:crypto';

// Persist delivery state separately from in-app reminders so failures remain retryable.
export function createExpiryMailer({db,all,uid,notify,notifyRoles,audit}){
 db.exec('CREATE TABLE IF NOT EXISTS email_deliveries(id TEXT PRIMARY KEY,status TEXT,sentAt TEXT,nextAttemptAt INTEGER,attempts INTEGER DEFAULT 0,lastError TEXT)');
 const inFlight=new Set();let closed=false;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function send(subscription,stage,daysRemaining){
  if(closed)return false;
  const customer=all('customers').find(c=>c.id===subscription.customerId);if(!customer?.email)return false;
  const reference=`${subscription.id}:${subscription.ends}`,id=createHash('sha256').update(`${reference}:${stage}`).digest('hex');
  if(inFlight.has(id))return false;
  const delivery=db.prepare('SELECT * FROM email_deliveries WHERE id=?').get(id);
  if(delivery?.status==='sent'||delivery?.nextAttemptAt>Date.now())return false;
  const product=all('products').find(p=>p.id===subscription.productId),currentPlan=all('plans').find(p=>p.id===subscription.planId),today=new Date().toISOString().slice(0,10);
  const productName=product?.name||'Software subscription',currency=subscription.currency||product?.currency||'USD';
  const fmt=(value,code=currency)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:code}).format(Number(value||0));
  const when=daysRemaining>1?`expires in ${daysRemaining} days`:daysRemaining===1?'expires tomorrow':daysRemaining===0?'expires today':`expired on ${subscription.ends}`;
  const title=`Your ${productName} subscription ${when}`,message=`${subscription.number} ${when}. Expiry date: ${subscription.ends}.`;
  notify(customer.userId,title,message,`subscription-expiry-${stage}`,reference);
  notifyRoles('Subscription expiry reminder',`${customer.name}: ${message}`,`subscription-expiry-${stage}-staff`,reference,subscription.customerId);
  const plans=all('plans').filter(p=>p.productId===subscription.productId&&(!p.starts||p.starts<=today)&&(!p.ends||p.ends>=today)&&p.price!==null&&p.price!==undefined&&Number.isFinite(Number(p.price)));
  const options=plans.map(p=>`${p.name}: ${fmt(p.price,p.currency||currency)} / ${p.cycle}, minimum ${p.minQuantity||1}`).join('\n')||'Contact Brightloop for current renewal options.';
  const appUrl=process.env.APP_URL||'http://localhost:3000';
  const text=`Hello ${customer.name},\n\n${message}\nProduct: ${productName}\nCurrent plan: ${currentPlan?.name||subscription.cycle}\nQuantity: ${subscription.quantity}\nUnit price: ${fmt(subscription.unitPrice)}\n\nAvailable plans (base prices; variants, tax and discounts may change the total):\n${options}\n\nManage your subscription: ${appUrl}\n\nBrightloop Software`;
  db.prepare('INSERT OR IGNORE INTO expiry_notices(id,subscriptionId,stage,sentAt) VALUES(?,?,?,NULL)').run(uid(),subscription.id,stage);
  db.prepare("INSERT OR IGNORE INTO email_deliveries(id,status,attempts) VALUES(?,'pending',0)").run(id);
  if(!process.env.SMTP_HOST)return false;
  inFlight.add(id);
  try{
   await nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_PORT==='465',connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined}).sendMail({from:process.env.MAIL_FROM,to:customer.email,subject:title,messageId:`<expiry-${id}@brightloop.local>`,text,html:`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#1b1d21"><h2 style="color:#0c6e34">Brightloop Software</h2><h3>${esc(title)}</h3><p style="white-space:pre-line;line-height:1.7">${esc(text)}</p><a href="${esc(appUrl)}" style="background:#25d366;color:#000;padding:12px 24px;border-radius:24px;display:inline-block">Open your portal</a></div>`});
   if(closed)return false;
   const now=new Date().toISOString();db.prepare("UPDATE email_deliveries SET status='sent',sentAt=?,attempts=attempts+1,lastError=NULL,nextAttemptAt=NULL WHERE id=?").run(now,id);
   db.prepare('UPDATE expiry_notices SET sentAt=? WHERE subscriptionId=? AND stage=?').run(now,subscription.id,stage);audit(null,`Sent ${stage} expiry reminder for ${subscription.number}`);return true;
  }catch(error){if(!closed){db.prepare("UPDATE email_deliveries SET status='pending',attempts=attempts+1,lastError=?,nextAttemptAt=? WHERE id=?").run(String(error.code||'SMTP delivery failed').slice(0,100),Date.now()+60000,id);console.error('Expiry email delivery failed; queued for retry.');}return false;}
  finally{inFlight.delete(id);}
 }
 send.close=()=>{closed=true;};return send;
}
