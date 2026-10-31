import ExcelJS from 'exceljs';

const field = (key,label,type='text',width=18) => ({key,label,type,width});

export const reportDefinitions = {
  subscriptions: {
    label:'Subscriptions', dateField:'starts', statusField:'status', currencyField:'currency',
    fields:[field('number','Subscription'),field('customer','Customer', 'text', 24),field('products','Products and variants','text',34),field('plan','Plan','text',24),field('cycle','Cycle'),field('starts','Start date','date'),field('nextBilling','Next billing','date'),field('quantity','Quantity','number',12),field('recurringValue','Recurring value','currency'),field('currency','Currency', 'text', 11),field('status','Status')],
    defaults:['number','customer','products','plan','cycle','starts','nextBilling','recurringValue','currency','status']
  },
  renewals: {
    label:'Renewals', dateField:'renewalDate', statusField:'status', currencyField:'currency',
    fields:[field('number','Subscription'),field('customer','Customer','text',24),field('products','Products','text',34),field('renewalDate','Renewal or expiry date','date',22),field('daysRemaining','Days remaining','number',16),field('status','Status'),field('action','Required action','text',26),field('currency','Currency','text',11)],
    defaults:['number','customer','products','renewalDate','daysRemaining','status','action']
  },
  invoices: {
    label:'Invoices', dateField:'billingDate', statusField:'status', currencyField:'currency',
    fields:[field('number','Invoice'),field('customer','Customer','text',24),field('billingDate','Billing date','date'),field('due','Due date','date'),field('currency','Currency','text',11),field('status','Status'),field('subtotal','Subtotal','currency'),field('discount','Discount','currency'),field('tax','Tax','currency'),field('total','Total','currency'),field('paid','Paid','currency'),field('balance','Balance','currency'),field('collectionStatus','Collection status','text',20)],
    defaults:['number','customer','billingDate','due','currency','status','total','paid','balance','collectionStatus']
  },
  payments: {
    label:'Payments', dateField:'date', currencyField:'currency',
    fields:[field('id','Payment'),field('invoice','Invoice'),field('customer','Customer','text',24),field('date','Payment date','date'),field('amount','Amount','currency'),field('currency','Currency','text',11),field('method','Method'),field('notes','Notes','text',34)],
    defaults:['id','invoice','customer','date','amount','currency','method','notes']
  },
  quotations: {
    label:'Quotations', dateField:'starts', statusField:'status', currencyField:'currency',
    fields:[field('number','Quotation'),field('customer','Customer','text',24),field('products','Products and variants','text',34),field('starts','Start date','date'),field('ends','Valid until','date'),field('currency','Currency','text',11),field('status','Status'),field('value','Quoted value','currency')],
    defaults:['number','customer','products','starts','ends','currency','status','value']
  },
  customers: {
    label:'Customers',
    fields:[field('name','Customer','text',24),field('email','Email','text',30),field('accountLinked','Account linked','text',16)],
    defaults:['name','email','accountLinked']
  }
};

const safeText = value => {
  const text = String(value ?? '');
  return /^[=+@-]/.test(text) ? `'${text}` : text;
};
const lines = record => Array.isArray(record.lines) && record.lines.length ? record.lines : [record];
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const isoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value||'')) ? new Date(`${value}T12:00:00Z`) : null;
const fileName = value => String(value||'Brightloop report').trim().replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,60).toLowerCase() || 'brightloop-report';

function normalizedRecords(dataset, records, today){
  const products = new Map(records.products.map(item=>[item.id,item]));
  const plans = new Map(records.plans.map(item=>[item.id,item]));
  const customers = new Map(records.customers.map(item=>[item.id,item]));
  const invoices = new Map(records.invoices.map(item=>[item.id,item]));
  const productNames = record => lines(record).map(line=>`${products.get(line.productId)?.name||'Product'}${line.variantName?` - ${line.variantName}`:''}`).join(', ');
  const value = record => lines(record).reduce((sum,line)=>sum+number(line.unitPrice)*number(line.quantity),0);
  const paidByInvoice = new Map();
  for(const payment of records.payments) paidByInvoice.set(payment.invoiceId,(paidByInvoice.get(payment.invoiceId)||0)+number(payment.amount));
  if(dataset==='subscriptions') return records.subscriptions.map(record=>({number:record.number||record.id,customer:customers.get(record.customerId)?.name||'Customer',products:productNames(record),plan:plans.get(record.planId)?.name||record.cycle||'Plan',cycle:record.cycle||'',starts:record.starts,nextBilling:record.nextBilling||'',quantity:lines(record).reduce((sum,line)=>sum+number(line.quantity),0),recurringValue:value(record),currency:record.currency||'INR',status:record.status||'Draft'}));
  if(dataset==='renewals') return records.subscriptions.map(record=>{const renewalDate=record.ends||record.nextBilling||record.starts||'';const daysRemaining=renewalDate?Math.ceil((new Date(`${renewalDate}T12:00:00Z`)-new Date(`${today}T12:00:00Z`))/86400000):null;const action=record.status==='Draft'?'Complete quotation':record.status==='Confirmed'?'Activate subscription':record.status==='Closed'?'No action':daysRemaining<0?'Review overdue date':daysRemaining<=30?'Renewal due within 30 days':'Scheduled';return {number:record.number||record.id,customer:customers.get(record.customerId)?.name||'Customer',products:productNames(record),renewalDate,daysRemaining,status:record.status||'Draft',action,currency:record.currency||'INR'};});
  if(dataset==='invoices') return records.invoices.map(record=>{const paid=paidByInvoice.get(record.id)||0,balance=Math.max(0,number(record.total)-paid);return {number:record.number||record.id,customer:customers.get(record.customerId)?.name||record.customer?.name||'Customer',billingDate:record.billingDate,due:record.due,currency:record.currency||'INR',status:record.status||'Draft',subtotal:number(record.subtotal),discount:number(record.discount),tax:number(record.tax),total:number(record.total),paid,balance,collectionStatus:record.status==='Cancelled'?'Cancelled':balance===0?'Paid':record.due&&record.due<today?'Overdue':record.status==='Draft'?'Awaiting confirmation':'Outstanding'};});
  if(dataset==='payments') return records.payments.map(record=>{const invoice=invoices.get(record.invoiceId);return {id:record.id,invoice:invoice?.number||record.invoiceId,customer:customers.get(invoice?.customerId)?.name||'Customer',date:record.date,amount:number(record.amount),currency:invoice?.currency||'INR',method:record.method||'Other',notes:record.notes||''};});
  if(dataset==='quotations') return records.quotations.map(record=>({number:record.number||record.id,customer:customers.get(record.customerId)?.name||'Customer',products:productNames(record),starts:record.starts||'',ends:record.ends||'',currency:record.currency||'INR',status:record.status||'Draft',value:value(record)}));
  return records.customers.map(record=>({name:record.name,email:record.email,accountLinked:record.userId?'Yes':'No'}));
}

export function reportSchema(){
  const statuses={subscriptions:['Draft','Quotation','Confirmed','Active','Paused','Closed'],renewals:['Draft','Confirmed','Active','Paused','Closed'],invoices:['Draft','Confirmed','Paid','Cancelled'],quotations:['Draft','Quotation','Confirmed','Expired']};
  return {datasets:Object.entries(reportDefinitions).map(([key,definition])=>({key,label:definition.label,fields:definition.fields,defaults:definition.defaults,statuses:statuses[key]||[],currencies:definition.currencyField?['INR','USD']:[]}))};
}

export async function createExcelReport(input, records, actor){
  const dataset = String(input.dataset||'');
  const definition = reportDefinitions[dataset];
  if(!definition) throw Object.assign(new Error('Choose a valid report type.'),{code:400});
  const allowed = new Map(definition.fields.map(item=>[item.key,item]));
  const selected = Array.isArray(input.fields) ? [...new Set(input.fields.map(String))] : [];
  if(!selected.length || selected.length>definition.fields.length || selected.some(key=>!allowed.has(key))) throw Object.assign(new Error('Choose at least one valid report column.'),{code:400});
  const title = String(input.title||`${definition.label} report`).trim();
  if(!title || title.length>80) throw Object.assign(new Error('Enter a report title up to 80 characters.'),{code:400});
  const statuses={subscriptions:['Draft','Quotation','Confirmed','Active','Paused','Closed'],renewals:['Draft','Confirmed','Active','Paused','Closed'],invoices:['Draft','Confirmed','Paid','Cancelled'],quotations:['Draft','Quotation','Confirmed','Expired']};
  if(input.status&&!(statuses[dataset]||[]).includes(input.status)) throw Object.assign(new Error('Choose a valid report status.'),{code:400});
  if(input.currency&&!['INR','USD'].includes(input.currency)) throw Object.assign(new Error('Choose a valid report currency.'),{code:400});
  const validDate = value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if(!validDate(input.dateFrom)||!validDate(input.dateTo)||input.dateFrom&&input.dateTo&&input.dateFrom>input.dateTo) throw Object.assign(new Error('Choose a valid date range.'),{code:400});
  const today = new Date().toISOString().slice(0,10);
  let rows = normalizedRecords(dataset,records,today);
  if(input.status) rows=rows.filter(row=>row.status===input.status);
  if(input.currency) rows=rows.filter(row=>row.currency===input.currency);
  if(definition.dateField&&input.dateFrom) rows=rows.filter(row=>row[definition.dateField]>=input.dateFrom);
  if(definition.dateField&&input.dateTo) rows=rows.filter(row=>row[definition.dateField]<=input.dateTo);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = actor.name;
  workbook.company = 'Brightloop Software';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(definition.label.slice(0,31),{views:[{state:'frozen',ySplit:5}]});
  const fields = selected.map(key=>allowed.get(key));
  sheet.getCell('A1').value=title;
  sheet.getCell('A1').font={name:'Arial',size:16,bold:true,color:{argb:'FF17251E'}};
  sheet.getCell('A2').value=`Created by ${safeText(actor.name)} (${safeText(actor.email)}) on ${new Date().toLocaleString('en-IN')}`;
  sheet.getCell('A2').font={name:'Arial',size:10,italic:true,color:{argb:'FF5F6F66'}};
  const filters=[input.status&&`Status: ${input.status}`,input.currency&&`Currency: ${input.currency}`,input.dateFrom&&`From: ${input.dateFrom}`,input.dateTo&&`To: ${input.dateTo}`].filter(Boolean).join(' · ');
  sheet.getCell('A3').value=filters||'All available records';
  sheet.getCell('A3').font={name:'Arial',size:10,color:{argb:'FF5F6F66'}};
  fields.forEach((item,index)=>{const cell=sheet.getCell(5,index+1);cell.value=item.label;cell.font={name:'Arial',size:10,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17864B'}};cell.alignment={vertical:'middle',horizontal:'center'};cell.border={bottom:{style:'thin',color:{argb:'FF0C6E34'}}};sheet.getColumn(index+1).width=item.width;});
  sheet.getRow(5).height=24;
  for(const source of rows){
    const row=sheet.addRow(fields.map(item=>item.type==='date'?isoDate(source[item.key]):item.type==='number'||item.type==='currency'?number(source[item.key]):safeText(source[item.key])));
    row.font={name:'Arial',size:10,color:{argb:'FF25332C'}};
    row.alignment={vertical:'middle'};
    row.height=21;
    fields.forEach((item,index)=>{const cell=row.getCell(index+1);if(item.type==='date')cell.numFmt='yyyy-mm-dd';if(item.type==='number')cell.numFmt='#,##0';if(item.type==='currency')cell.numFmt='#,##0.00';cell.border={bottom:{style:'hair',color:{argb:'FFE4EBE7'}}};});
  }
  if(rows.length) sheet.autoFilter={from:{row:5,column:1},to:{row:5,column:fields.length}};
  else {const row=sheet.addRow(['No matching records',...Array(Math.max(0,fields.length-1)).fill(null)]);row.font={name:'Arial',size:10,italic:true,color:{argb:'FF6B756F'}};}
  sheet.pageSetup={orientation:fields.length>7?'landscape':'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:0.3,right:0.3,top:0.5,bottom:0.5,header:0.2,footer:0.2}};
  sheet.headerFooter.oddFooter='&LBrightloop Software&CPage &P of &N&RGenerated from the staff portal';
  return {buffer:Buffer.from(await workbook.xlsx.writeBuffer()),filename:`${fileName(title)}-${today}.xlsx`,count:rows.length};
}
