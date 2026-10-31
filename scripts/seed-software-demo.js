import {DatabaseSync} from 'node:sqlite';
import {createHash,randomInt} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {softwareProducts} from '../software-catalog.js';
const id=key=>createHash('sha256').update('brightloop-demo-v1:'+key).digest('hex').slice(0,24);
const shuffle=list=>{const a=[...list];for(let i=a.length-1;i;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
export function seedSoftware(db){
 const insert=(type,r)=>db.prepare('INSERT OR IGNORE INTO records VALUES(?,?,?)').run(r.id,type,JSON.stringify(r));
 const all=type=>db.prepare('SELECT body FROM records WHERE type=?').all(type).map(r=>JSON.parse(r.body));
 db.exec('BEGIN IMMEDIATE');try{
  for(const p of softwareProducts){insert('products',{...p,id:id(p.key),currency:'INR',cost:null,notes:'Fictional demonstration product. Cost price is not supplied.',variants:p.variants||[{id:'standard',name:'Standard',extraPrice:0}],demoSet:'brightloop-v1'});
   for(const cycle of ['Monthly','Yearly']){const multiplier=cycle==='Yearly'?12:1;insert('plans',{id:id(p.key+cycle),productId:id(p.key),name:p.name+' · '+cycle,price:p.price*multiplier,currency:'INR',variantMultiplier:multiplier,cycle,minQuantity:1,allowPause:true,allowClose:true,allowRenew:true,demoSet:'brightloop-v1'});}}
  const names=shuffle(['Aarav Shah','Maya Brooks','Daniel Reed','Priya Menon','Noah Patel','Sofia Chen','Liam Wilson','Ananya Rao','Ethan Clark','Isla Morgan','Arjun Nair','Emma Davis','Lucas Martin','Zara Ali','Oliver Hayes','Meera Iyer','Aiden Thomas','Amelia Scott','Kabir Kapoor','Chloe Bennett']);
  const products=shuffle(Array.from({length:20},(_,i)=>softwareProducts[i%softwareProducts.length]));let created=0;
  names.forEach((name,i)=>{if(all('customers').some(c=>c.id===id('customer'+i)))return;const p=products[i],variant=(p.variants||[{id:'standard',name:'Standard',extraPrice:0}])[randomInt(p.variants?.length||1)],customerId=id('customer'+i),today=new Date().toISOString().slice(0,10);insert('customers',{id:customerId,name,email:`software.customer${String(i+1).padStart(2,'0')}@example.test`,company:'Fictional demo customer',demoSet:'brightloop-v1'});insert('subscriptions',{id:id('subscription'+i),number:`BL-DEMO-${i+1}`,customerId,productId:id(p.key),planId:id(p.key+'Monthly'),variantId:variant.id,variantName:variant.name,quantity:1,unitPrice:p.price+variant.extraPrice,currency:'INR',cycle:'Monthly',starts:today,nextBilling:today,ends:'',status:i%5===0?'Draft':'Active',terms:'Net 15',businessType:'software',demoSet:'brightloop-v1'});created++;});
  db.exec('COMMIT');return {products:all('products').filter(p=>p.demoSet==='brightloop-v1').length,plans:all('plans').filter(p=>p.demoSet==='brightloop-v1').length,createdCustomers:created,totalDemoCustomers:all('customers').filter(c=>c.demoSet==='brightloop-v1').length};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(!process.env.DATA_DIR)throw Error('Set DATA_DIR to the intended demo database.');const db=new DatabaseSync(join(resolve(process.env.DATA_DIR),'subscript.db'));try{console.log(JSON.stringify(seedSoftware(db)));}finally{db.close();}}
