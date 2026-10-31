import {DatabaseSync} from 'node:sqlite';
import {createHash,randomInt} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {airaModels,levels} from '../aira-catalog.js';

const id=key=>createHash('sha256').update('aira-demo-v1:'+key).digest('hex').slice(0,24);
const shuffled=items=>{const result=[...items];for(let i=result.length-1;i>0;i--){const j=randomInt(i+1);[result[i],result[j]]=[result[j],result[i]];}return result;};
export function seedAira(db){
 const all=type=>db.prepare('SELECT body FROM records WHERE type=?').all(type).map(r=>JSON.parse(r.body));
 const insert=(type,record)=>db.prepare('INSERT OR IGNORE INTO records(id,type,body) VALUES(?,?,?)').run(record.id,type,JSON.stringify(record));
 const staff=db.prepare("SELECT id,name FROM users WHERE role='staff' ORDER BY id").all();
 if(!staff.length)throw Error('Create at least one staff account through the admin before seeding customers.');
 const today=new Date().toISOString().slice(0,10),validUntil=new Date(Date.now()+15*86400000).toISOString().slice(0,10);
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const model of airaModels){
   insert('products',{id:id('band:'+model.key),name:model.name,brand:'Aira',modelKey:model.key,kind:'band',price:null,cost:null,description:model.description,specifications:model.specifications,colors:model.colors||[],wellnessNotice:model.wellnessNotice||'',notes:'Hardware sale price not supplied. Admin must set a price before selling the device.',demoSet:'aira-v1'});
   model.plans.forEach((plan,index)=>{
    const planId=id('plan:'+plan.name),productId=id('service:'+plan.name);
    insert('products',{id:productId,name:plan.name+' · Monitoring',price:plan.price,cost:null,kind:'monitoring',brand:'Aira',modelKey:model.key,planId,tier:levels[index],features:plan.features,notes:plan.features.join('; '),demoSet:'aira-v1'});
    insert('plans',{id:planId,name:plan.name,price:plan.price,cycle:'Monthly',minQuantity:1,modelKey:model.key,tier:levels[index],features:plan.features,monitoringProductId:productId,demoSet:'aira-v1'});
   });
  }
  const names=shuffled(['Aarav Shah','Maya Brooks','Daniel Reed','Priya Menon','Noah Patel','Sofia Chen','Liam Wilson','Ananya Rao','Ethan Clark','Isla Morgan','Arjun Nair','Emma Davis','Lucas Martin','Zara Ali','Oliver Hayes','Meera Iyer','Aiden Thomas','Amelia Scott','Kabir Kapoor','Chloe Bennett']);
  // Four customers per model; shuffled customers, plans and staff assignments.
  const models=shuffled(airaModels.flatMap(m=>[m,m,m,m]));
  const staffOrder=shuffled(Array.from({length:20},(_,i)=>staff[i%staff.length]));
  const planChoices=new Map(airaModels.map(m=>[m.key,shuffled([...m.plans,m.plans[randomInt(3)]])]));
  let created=0;
  names.forEach((name,index)=>{
   const customerId=id('customer:'+index);
   if(all('customers').some(c=>c.id===customerId))return;
   const model=models[index],plan=planChoices.get(model.key).pop(),owner=staffOrder[index],planId=id('plan:'+plan.name),productId=id('service:'+plan.name),subscriptionId=id('subscription:'+index);
   insert('customers',{id:customerId,name,email:`aira.customer${String(index+1).padStart(2,'0')}@example.test`,company:'Aira demo customer',assignedStaffId:owner.id,notes:'Fictional sample customer. Monitoring subscription only; hardware price is unset.',demoSet:'aira-v1'});
   const lines=[{productId,name:plan.name+' · Monitoring',quantity:1,unitPrice:plan.price,charge:'Recurring'}];
   insert('subscriptions',{id:subscriptionId,number:`AIRA-${String(index+1).padStart(4,'0')}`,staffSale:true,customerId,planId,modelKey:model.key,cycle:'Monthly',starts:today,ends:'',nextBilling:today,status:'Active',terms:'Net 15',taxId:'',discountId:'',lines,productId,quantity:1,unitPrice:plan.price,validDays:15,validUntil,createdBy:owner.id,createdAt:new Date().toISOString(),quoteTotals:{subtotal:plan.price,discount:0,tax:0,total:plan.price,lines:lines.map(l=>({...l,amount:plan.price}))},history:[{time:new Date().toISOString(),action:'Fictional Aira demo monitoring subscription created',by:'Demo setup'}],demoSet:'aira-v1'});
   insert('staffTasks',{id:id('task:'+index),customerId,assignedStaffId:owner.id,title:`Check ${model.name} onboarding`,due:today,status:'Open',demoSet:'aira-v1'});created++;
  });
  db.exec('COMMIT');
  const customers=all('customers').filter(c=>c.demoSet==='aira-v1'),subscriptions=all('subscriptions').filter(s=>s.demoSet==='aira-v1');
  return {created,totalCustomers:customers.length,models:airaModels.map(m=>({model:m.name,customers:subscriptions.filter(s=>s.modelKey===m.key).length})),plans:airaModels.flatMap(m=>m.plans.map(p=>({plan:p.name,customers:subscriptions.filter(s=>s.planId===id('plan:'+p.name)).length}))),staff:staff.map(u=>({name:u.name,customers:customers.filter(c=>c.assignedStaffId===u.id).length}))};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(!process.env.DATA_DIR)throw Error('Set DATA_DIR to the intended local demo database directory.');
 const db=new DatabaseSync(join(resolve(process.env.DATA_DIR),'subscript.db'));
 try{console.log(JSON.stringify(seedAira(db),null,2));}finally{db.close();}
}
