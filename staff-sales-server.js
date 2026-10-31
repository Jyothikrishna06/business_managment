import nodemailer from 'nodemailer';

export function createStaffSales({all,put,uid,fail,assignedCustomer,audit,calculate,bill,db}){
  const today=()=>new Date().toISOString().slice(0,10);
  const date=(value,label)=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail(`Enter a valid ${label}.`);return value;};
  const balance=i=>Math.round((i.total-all('payments').filter(p=>p.invoiceId===i.id).reduce((n,p)=>n+Number(p.amount),0))*100)/100;
  const contract=(u,id)=>{const s=all('subscriptions').find(s=>s.id===id&&s.staffSale);if(!s)fail('Sale not found.',404);assignedCustomer(u,s.customerId);return s;};
  const invoice=(u,id)=>{const i=all('invoices').find(i=>i.id===id);if(!i)fail('Invoice not found.',404);assignedCustomer(u,i.customerId);return i;};
  function lineItems(lines){
    if(!Array.isArray(lines)||!lines.length||lines.length>20)fail('Add between 1 and 20 order lines.');
    return lines.map(line=>{
      const p=all('products').find(p=>p.id===line.productId);
      if(!p||p.price===null||p.price===''||!Number.isFinite(Number(p.price))||Number(p.price)<0)fail('Choose an available catalog product.');
      if(!Number.isInteger(Number(line.quantity))||Number(line.quantity)<1||Number(line.quantity)>100000)fail('Enter a whole quantity between 1 and 100000.');
      if(p.kind==='band'&&line.charge!=='Once'||p.kind==='monitoring'&&line.charge!=='Recurring')fail('Band purchases are one-time; monitoring services are recurring.');
      if(!['Once','Recurring'].includes(line.charge))fail('Choose one-time purchase or recurring monitoring.');
      return {productId:p.id,name:p.name,quantity:Number(line.quantity),unitPrice:Number(p.price),charge:line.charge};
    });
  }
  function state(u){
    const ids=new Set(all('customers').filter(c=>c.assignedStaffId===u.id).map(c=>c.id));
    const invoices=all('invoices').filter(i=>ids.has(i.customerId));
    return {
      catalog:all('products').map(({id,name,price,notes,kind,brand,modelKey,planId,tier,features,description,specifications,colors,wellnessNotice})=>({id,name,price,notes,kind,brand,modelKey,planId,tier,features,description,specifications,colors,wellnessNotice})),
      plans:all('plans'),taxes:all('taxes'),discounts:all('discounts'),
      contracts:all('subscriptions').filter(s=>s.staffSale&&ids.has(s.customerId)).map(s=>({...s,preview:s.quoteTotals||calculate(s,s.starts)})),
      invoices:invoices.map(i=>({...i,balance:balance(i)})),
      payments:all('payments').filter(p=>invoices.some(i=>i.id===p.invoiceId)),
      templates:all('staffSaleTemplates').filter(t=>t.ownerId===u.id)
    };
  }
  async function handle(u,path,method,b){
    if(u.role!=='staff')fail('Staff access required.',403);
    const route=path.match(/^\/api\/staff\/sales\/(contracts|invoices|payments|billing|templates)(?:\/([a-f0-9]+))?$/);
    if(!route)fail('Not found.',404);
    const [,kind,id]=route;
    if(kind==='contracts'&&(method==='POST'&&!id||method==='PATCH'&&id&&b.lines)){
      const old=id?contract(u,id):null;
      if(old&&(!['Draft','Quotation'].includes(old.status)||all('invoices').some(i=>i.subscriptionId===id)))fail('Only unbilled drafts and quotations can be edited.');
      const customer=assignedCustomer(u,b.customerId),plan=all('plans').find(p=>p.id===b.planId);
      if(!plan)fail('Choose an approved plan.');
      const starts=date(b.starts,'start date'),ends=b.ends?date(b.ends,'expiry date'):'';
      if(ends&&ends<starts)fail('Expiry must follow the start date.');
      if(plan.starts&&starts<plan.starts||plan.ends&&starts>plan.ends)fail('The plan is unavailable on this date.');
      const lines=lineItems(b.lines),recurring=lines.filter(l=>l.charge==='Recurring');
      for(const line of lines){const p=all('products').find(p=>p.id===line.productId);if(p.planId&&p.planId!==plan.id||plan.modelKey&&p.modelKey!==plan.modelKey)fail('Choose products and monitoring service that match the selected Aira model and plan.');}
      if(plan.monitoringProductId&&(recurring.length!==1||recurring[0].productId!==plan.monitoringProductId))fail('This Aira plan requires its matching monitoring service.');
      if(!recurring.length)fail('Add a recurring health-monitoring service line.');
      if(recurring.some(l=>l.quantity<Number(plan.minQuantity||1)))fail('Monitoring quantity is below the plan minimum.');
      if(b.taxId&&!all('taxes').some(t=>t.id===b.taxId))fail('Choose an approved tax rule.');
      if(b.discountId&&!all('discounts').some(t=>t.id===b.discountId))fail('Choose an approved discount.');
      if(!['Due on receipt','Net 7','Net 15','Net 30','Net 60'].includes(b.terms))fail('Choose payment terms.');
      const validDays=Number(b.validDays);if(!Number.isInteger(validDays)||validDays<1||validDays>90)fail('Quotation validity must be 1–90 days.');
      const validUntil=new Date();validUntil.setUTCDate(validUntil.getUTCDate()+validDays);
      const first=recurring[0],record={id:old?.id||uid(),number:old?.number||`SUB-${uid().slice(0,8).toUpperCase()}`,staffSale:true,customerId:customer.id,planId:plan.id,cycle:plan.cycle,starts,ends,nextBilling:starts,status:old?.status||'Draft',terms:b.terms,taxId:b.taxId||'',discountId:b.discountId||'',lines,productId:first.productId,quantity:first.quantity,unitPrice:first.unitPrice,validDays,validUntil:validUntil.toISOString().slice(0,10),createdBy:old?.createdBy||u.id,createdAt:old?.createdAt||new Date().toISOString(),history:[...(old?.history||[]),{time:new Date().toISOString(),action:old?'Quotation details updated':'Draft created',by:u.name}]};
      record.quoteTotals=calculate(record,record.starts);put('subscriptions',record);audit(u,`${old?'Updated':'Created'} health-band sale ${record.number}`);return record;
    }
    if(kind==='contracts'&&method==='PATCH'&&id){
      const s=contract(u,id),next=b.status,allowed={Draft:['Quotation'],Quotation:['Draft','Confirmed'],Confirmed:['Quotation','Active'],Active:['Paused','Closed'],Paused:['Active','Closed'],Closed:[]};
      if(!allowed[s.status]?.includes(next))fail('This status change is not allowed.');
      if(['Quotation','Confirmed'].includes(next)&&s.validUntil<today())fail('Quotation expired. Create a new offer.');
      if(next==='Quotation'&&all('invoices').some(i=>i.subscriptionId===id))fail('Billed subscriptions cannot return to quotation.');
      if(next==='Active'&&s.ends&&s.ends<today())fail('This subscription has expired. Create a renewal.');
      const updated={...s,status:next,history:[...(s.history||[]),{time:new Date().toISOString(),action:`${s.status} → ${next}`,by:u.name}]};put('subscriptions',updated);audit(u,`Sale ${s.number}: ${next}`);return updated;
    }
    if(kind==='templates'&&method==='POST'&&!id){
      const s=contract(u,b.contractId);if(typeof b.name!=='string'||!b.name.trim()||b.name.length>100)fail('Enter a template name under 100 characters.');
      if(all('staffSaleTemplates').filter(t=>t.ownerId===u.id).length>=30)fail('A maximum of 30 templates is supported.');
      const template={id:uid(),ownerId:u.id,name:b.name.trim(),planId:s.planId,terms:s.terms,taxId:s.taxId,discountId:s.discountId,validDays:s.validDays||15,lines:s.lines.map(({productId,quantity,charge})=>({productId,quantity,charge}))};put('staffSaleTemplates',template);audit(u,'Saved quotation template');return template;
    }
    if(kind==='billing'&&method==='POST'&&!id){const ids=new Set(all('customers').filter(c=>c.assignedStaffId===u.id).map(c=>c.id));const count=bill(ids);audit(u,`Generated ${count} assigned-customer invoices`);return {count};}
    if(kind==='invoices'&&method==='POST'&&!id&&b.action==='confirmAll'){
      const ids=new Set(all('customers').filter(c=>c.assignedStaffId===u.id).map(c=>c.id));
      const drafts=all('invoices').filter(i=>ids.has(i.customerId)&&i.status==='Draft');
      db.exec('BEGIN IMMEDIATE');try{for(const i of drafts)put('invoices',{...i,status:i.total===0?'Paid':'Confirmed'});db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
      audit(u,`Confirmed ${drafts.length} assigned invoice drafts`);return {count:drafts.length};
    }
    if(kind==='invoices'&&method==='POST'&&id){
      const i=invoice(u,id);
      if(b.action==='confirm'){if(i.status!=='Draft')fail('Only draft invoices can be confirmed.');put('invoices',{...i,status:i.total===0?'Paid':'Confirmed'});}
      else if(b.action==='cancel'){if(!['Draft','Confirmed'].includes(i.status)||all('payments').some(p=>p.invoiceId===id))fail('Only unpaid invoices without payments can be cancelled.');put('invoices',{...i,status:'Cancelled'});}
      else if(b.action==='send'||b.action==='remind'){
        if(!['Confirmed','Paid'].includes(i.status))fail('Confirm the invoice before sending.');
        if(b.action==='remind'&&balance(i)<=0)fail('This invoice has no balance due.');
        if(!process.env.SMTP_HOST)fail('Email delivery is not configured. Contact your administrator.',503);
        const c=assignedCustomer(u,i.customerId);
        await nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_PORT==='465',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined}).sendMail({from:process.env.MAIL_FROM,to:c.email,subject:`${b.action==='remind'?'Payment reminder: ':''}Invoice ${i.number}`,text:`Hello ${c.name},\nInvoice ${i.number}\nDue: ${i.due}\nTotal: USD ${i.total}\nBalance: USD ${balance(i)}\nPlease sign in to your Subscript portal to view your invoice.`});
      }else fail('Choose a valid invoice action.');audit(u,`${b.action} invoice ${i.number}`);return {ok:true};
    }
    if(kind==='payments'&&method==='POST'&&!id){
      const i=invoice(u,b.invoiceId);if(i.status!=='Confirmed')fail('Payments require a confirmed invoice.');
      const amount=Number(b.amount);if(!Number.isFinite(amount)||amount<=0||Math.abs(amount*100-Math.round(amount*100))>0.00001||amount>balance(i))fail('Enter a positive amount within the outstanding balance, with at most two decimal places.');
      if(!['Bank transfer','Card','Cash','Other'].includes(b.method))fail('Choose a payment method.');
      const paymentDate=date(b.date,'payment date');if(paymentDate>today())fail('Payment date cannot be in the future.');
      if(typeof b.notes!=='string'||b.notes.length>2000)fail('Enter notes under 2000 characters.');
      const remaining=Math.round((balance(i)-amount)*100)/100;
      const payment={id:uid(),invoiceId:i.id,amount,method:b.method,date:paymentDate,notes:b.notes.trim()};
      db.exec('BEGIN IMMEDIATE');try{put('payments',payment);put('invoices',{...i,status:remaining===0?'Paid':'Confirmed'});db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
      audit(u,`Recorded payment for ${i.number}`);return payment;
    }
    fail('Action not allowed.',405);
  }
  return {state,handle};
}
