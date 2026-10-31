// Customer operations derive ownership, prices and permissions on the server.
export function createSoftwarePortal({all,put,uid,fail,audit,nextDate,calculate,db,notifyQuotation}){
 const today=()=>new Date().toISOString().slice(0,10);
 const available=p=>(!p.starts||p.starts<=today())&&(!p.ends||p.ends>=today());
 function catalog(){return all('products').filter(p=>['Software','Service','Add-on'].includes(p.productType)).map(({id,name,productType,price,currency,description,features,icon,variants})=>({id,name,productType,price,currency:currency||'INR',description:description||'',features:features||[],icon:icon||'apps',variants:variants||[{id:'standard',name:'Standard',extraPrice:0}],plans:all('plans').filter(p=>p.productId===id&&available(p)&&p.price!==null&&p.price!==''&&p.price!==undefined&&Number.isFinite(Number(p.price))).map(({id,name,price,currency,cycle,minQuantity,variantMultiplier,allowPause,allowClose,allowRenew})=>({id,name,price:Number(price),currency:currency||'INR',cycle,minQuantity:Number(minQuantity||1),variantMultiplier:Number(variantMultiplier||1),allowPause:allowPause===true,allowClose:allowClose===true,allowRenew:allowRenew===true}))}));}
 function own(user,id){const s=all('subscriptions').find(s=>s.id===id),customer=s&&all('customers').find(c=>c.id===s.customerId&&c.userId===user.id);if(!customer)fail('Subscription not found.',404);return s;}
 function activateWithDemoPayment(s,user,customer,product,plan){
  if(process.env.ENABLE_DEMO_CHECKOUT!=='true')fail('Demo checkout is disabled. Request a subscription for team review.',403);
  const existing=all('invoices').find(i=>i.subscriptionId===s.id&&i.billingDate===today());
  if(existing){if(existing.demoCheckout&&s.status==='Active')return s;fail('This subscription already has an invoice. Contact the team.');}
  const totals=calculate(s,today());
  const updated={...s,status:'Active',demoCheckout:true,terms:'Demo Instant Payment',nextBilling:nextDate(today(),plan.cycle||s.cycle||'Monthly',Number(today().slice(8,10)))};
  put('subscriptions',updated);
  const invoice={id:uid(),number:`INV-${uid().slice(0,8).toUpperCase()}`,customerId:customer.id,subscriptionId:s.id,billingDate:today(),due:today(),currency:s.currency,status:'Paid',demoCheckout:true,line:totals.lines[0],customer:{name:customer.name,email:customer.email},terms:'Demo Instant Payment',...totals};
  put('invoices',invoice);
  if(totals.total>0)put('payments',{id:uid(),invoiceId:invoice.id,amount:totals.total,method:'Card',date:today(),notes:'Demo instant checkout payment',demoCheckout:true});
  if(totals.discount&&s.discountId){const rule=all('discounts').find(d=>d.id===s.discountId);put('discounts',{...rule,used:Number(rule.used||0)+1});}
  if(s.quotationId){const quote=all('quotations').find(q=>q.id===s.quotationId);if(quote)put('quotations',{...quote,status:'Confirmed',subscriptionId:s.id});}
  audit(user,`Demo checkout for ${product.name} (${s.number}); no actual charge`);return updated;
 }
 function draft(user,b){
  if(Object.keys(b).some(k=>!['planId','variantId','quantity','payNow','checkoutKey'].includes(k)))fail('Only a plan, variant and quantity may be selected.');
  const plan=all('plans').find(p=>p.id===b.planId),product=plan&&all('products').find(p=>p.id===plan.productId);
  if(!plan||!product||plan.price===null||plan.price===''||plan.price===undefined||!available(plan)||!['Software','Service','Add-on'].includes(product.productType))fail('This software plan is unavailable.');
  const variant=(product.variants||[{id:'standard',name:'Standard',extraPrice:0}]).find(v=>v.id===(b.variantId||'standard'));
  if(!variant)fail('Choose a valid product variant.');
  const quantity=Number(b.quantity);if(!Number.isInteger(quantity)||quantity<Math.max(1,Number(plan.minQuantity||1))||quantity>100000)fail('Enter a whole quantity above the plan minimum.');
  const customer=all('customers').find(c=>c.userId===user.id);if(!customer)fail('Customer account not found.',404);
  const price=Math.round((Number(plan.price)+Number(variant.extraPrice)*Number(plan.variantMultiplier||1))*100)/100;
  if(!Number.isFinite(price)||price<0)fail('This plan has invalid pricing. Contact your administrator.');
  const isPayNow=b.payNow===true||b.payNow==='true';if(isPayNow&&process.env.ENABLE_DEMO_CHECKOUT!=='true')fail('Demo checkout is disabled.',403);if(b.checkoutKey&&(!/^[a-zA-Z0-9-]{16,100}$/.test(b.checkoutKey)))fail('Invalid checkout reference.');if(b.checkoutKey){const previous=all('subscriptions').find(s=>s.customerId===customer.id&&s.checkoutKey===b.checkoutKey);if(previous)return previous;}
  if(!isPayNow){
    const existing=all('subscriptions').find(s=>s.customerId===customer.id&&s.planId===plan.id&&s.variantId===variant.id&&Number(s.quantity)===quantity&&s.status==='Draft');if(existing)return existing;
  }
  const line={id:uid(),productId:product.id,planId:plan.id,variantId:variant.id,variantName:variant.name,quantity,unitPrice:price,taxId:plan.taxId||'',discountId:plan.discountId||''};
  const s={id:uid(),number:`SUB-${uid().slice(0,8).toUpperCase()}`,businessType:'software',customerId:customer.id,...line,lines:[line],currency:plan.currency||product.currency||'INR',cycle:plan.cycle,starts:today(),nextBilling:today(),ends:'',status:isPayNow?'Active':'Draft',terms:isPayNow?'Demo Instant Payment':'Net 15',taxId:plan.taxId||'',discountId:plan.discountId||'',createdAt:new Date().toISOString()};
  if(b.checkoutKey)s.checkoutKey=b.checkoutKey;put('subscriptions',s);
  if(isPayNow)return activateWithDemoPayment(s,user,customer,product,plan,variant,price,quantity);
  const quote={...s,id:uid(),number:`QUO-${uid().slice(0,8).toUpperCase()}`,sourceSubscriptionId:s.id,subscriptionEnds:s.ends,ends:new Date(Date.now()+15*86400000).toISOString().slice(0,10),status:'Quotation'};delete quote.checkoutKey;put('quotations',quote);s.quotationId=quote.id;put('subscriptions',s);notifyQuotation(quote,'created');
  audit(user,`Requested ${product.name} · ${variant.name}`);
  return s;
 }
 function handle(user,path,method,b){
  if(user.role!=='customer')fail('Customer access required.',403);
  if(path==='/api/customer/subscriptions'&&method==='POST'){db.exec('BEGIN IMMEDIATE');try{const result=draft(user,b);db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 const payMatch=path.match(/^\/api\/customer\/subscriptions\/([a-f0-9]+)\/pay$/);
 if(payMatch&&method==='POST'){
  const s=own(user,payMatch[1]);
  if(s.status==='Active'&&s.demoCheckout)return s;if(s.status!=='Draft')fail('Only draft subscriptions can use demo checkout.',400);if(s.lines?.length>1)fail('Ask the team to confirm a multi-product quotation.');if(s.quotationId){const quote=all('quotations').find(q=>q.id===s.quotationId);if(quote?.status==='Expired'||quote?.ends<today())fail('This quotation has expired. Request a new quotation.');}
  const plan=all('plans').find(p=>p.id===s.planId),product=plan&&all('products').find(p=>p.id===plan.productId);
  if(!plan||!product)fail('Plan or product no longer available.',404);
  const variant=(product.variants||[{id:'standard',name:'Standard',extraPrice:0}]).find(v=>v.id===(s.variantId||'standard'))||{id:'standard',name:'Standard',extraPrice:0};
  const customer=all('customers').find(c=>c.userId===user.id);
  db.exec('BEGIN IMMEDIATE');try{const result=activateWithDemoPayment(s,user,customer,product,plan);db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
 }
  const addonMatch=path.match(/^\/api\/customer\/subscriptions\/([a-f0-9]+)\/addons$/);if(addonMatch){const s=own(user,addonMatch[1]);if(!['Confirmed','Active','Paused'].includes(s.status))fail('Add-ons can be changed after the subscription is confirmed.',403);const lines=Array.isArray(s.lines)&&s.lines.length?s.lines.map(line=>({...line})):[{id:uid(),productId:s.productId,planId:s.planId,variantId:s.variantId,variantName:s.variantName,quantity:s.quantity,unitPrice:s.unitPrice,taxId:s.taxId||''}];if(method==='POST'){if(Object.keys(b).some(key=>!['planId','variantId','quantity'].includes(key)))fail('Choose an add-on plan, variant and quantity.');const plan=all('plans').find(item=>item.id===b.planId),product=plan&&all('products').find(item=>item.id===plan.productId);if(!plan||product?.productType!=='Add-on'||!available(plan)||plan.cycle!==s.cycle||(plan.currency||product.currency||'INR')!==(s.currency||'USD'))fail('Choose an available add-on plan.');const variant=(product.variants||[{id:'standard',name:'Standard',extraPrice:0}]).find(item=>item.id===(b.variantId||'standard'));if(!variant)fail('Choose a valid add-on variant.');const quantity=Number(b.quantity);if(!Number.isInteger(quantity)||quantity>100000||quantity<Math.max(1,Number(plan.minQuantity||1)))fail('Enter a valid add-on quantity.');const unitPrice=Math.round((Number(plan.price)+Number(variant.extraPrice)*Number(plan.variantMultiplier||1))*100)/100;if(!Number.isFinite(unitPrice)||unitPrice<0)fail('The add-on pricing is unavailable.');if(lines.length>=25)fail('Use at most 25 order lines.');lines.push({id:uid(),productId:product.id,planId:plan.id,variantId:variant.id,variantName:variant.name,quantity,unitPrice,taxId:plan.taxId||''});const updated={...s,lines};put('subscriptions',updated);audit(user,`Added ${product.name} to ${s.number}`);return updated;}if(method==='DELETE'){const line=lines.find(item=>item.id===b.lineId),product=line&&all('products').find(item=>item.id===line.productId);if(!line||line.id===lines[0].id||product?.productType!=='Add-on')fail('Choose an attached add-on.',404);const updated={...s,lines:lines.filter(item=>item.id!==line.id)};put('subscriptions',updated);audit(user,`Removed ${product.name} from ${s.number}`);return updated;}fail('Action not allowed.',405);}
  const match=path.match(/^\/api\/customer\/subscriptions\/([a-f0-9]+)$/);if(!match||method!=='PATCH')fail('Action not allowed.',405);
  if(Object.keys(b).some(k=>k!=='action'))fail('Only a supported subscription action is allowed.');
  const s=own(user,match[1]),plan=all('plans').find(p=>p.id===s.planId);if(!plan)fail('Billing plan unavailable.');
  if(b.action==='renew'){
   if(plan.allowRenew!==true||s.status!=='Closed')fail('Renewal is not permitted for this subscription.',403);
   db.exec('BEGIN IMMEDIATE');try{const result=draft(user,{planId:s.planId,variantId:s.variantId,quantity:s.quantity});if(s.lines?.length>1){result.lines=[result.lines[0],...s.lines.slice(1).map(line=>{const plan=all('plans').find(p=>p.id===line.planId),product=plan&&all('products').find(p=>p.id===plan.productId),variant=product?.variants?.find(v=>v.id===line.variantId)||(!product?.variants?{id:'standard',name:'Standard',extraPrice:0}:null);if(!plan||!product||!variant||!available(plan)||plan.cycle!==result.cycle||(plan.currency||product.currency||'INR')!==result.currency)fail('Ask the team to replace an unavailable renewal add-on.');const unitPrice=Math.round((Number(plan.price)+Number(variant.extraPrice)*Number(plan.variantMultiplier||1))*100)/100;if(!Number.isFinite(unitPrice)||unitPrice<0)fail('The renewal add-on price is unavailable.');return {...line,id:uid(),variantName:variant.name,unitPrice};})];put('subscriptions',result);const quote=all('quotations').find(q=>q.id===result.quotationId);if(quote)put('quotations',{...quote,lines:result.lines});}audit(user,`Requested renewal of ${s.number}`);db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
  }
  const next={pause:'Paused',resume:'Active',close:'Closed'}[b.action];
  if(b.action==='pause'&&(plan.allowPause!==true||s.status!=='Active')||b.action==='resume'&&(plan.allowPause!==true||s.status!=='Paused'||s.ends&&s.ends<today())||b.action==='close'&&(plan.allowClose!==true||!['Active','Paused','Confirmed'].includes(s.status))||!next)fail('This action is not permitted by your billing plan.',403);
  // Skip paused periods instead of billing them on resumption.
  if(b.action==='resume'){let due=s.nextBilling||s.starts;while(due<today())due=nextDate(due,s.cycle,Number(s.starts.slice(8,10)));s.nextBilling=due;}
  const updated={...s,status:next};put('subscriptions',updated);audit(user,`${b.action} subscription ${s.number}`);return updated;
 }
 return {catalog,handle};
}
