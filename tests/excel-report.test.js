import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import ExcelJS from 'exceljs';
import {seedSoftware} from '../scripts/seed-software-demo.js';

test('staff can build a filtered Excel report while customers cannot export workspace data', async t=>{
  const dir=mkdtempSync(join(tmpdir(),'brightloop-excel-test-'));
  const port=18000+Math.floor(Math.random()*10000);
  const db=new DatabaseSync(join(dir,'subscript.db'));
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT,status TEXT DEFAULT 'active'); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,userId TEXT,expires INTEGER); CREATE TABLE IF NOT EXISTS resets(token TEXT PRIMARY KEY,userId TEXT,expires INTEGER); CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,type TEXT,body TEXT); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,time TEXT,userId TEXT,action TEXT);`);
  seedSoftware(db);db.close();
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),APP_URL:`http://localhost:${port}`,DATA_DIR:dir,DEV_RESET_LINKS:'true',SMTP_HOST:''},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
  t.after(async()=>{child.kill();if(child.exitCode===null)await once(child,'exit');const target=resolve(dir);if(target.startsWith(resolve(tmpdir())+sep)&&target.includes('brightloop-excel-test-'))rmSync(target,{recursive:true,force:true});});
  for(let n=0;n<120&&!output.includes('running at');n++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.match(output,/running at/);

  const request=async(path,method='GET',body,cookie)=>{
    const response=await fetch(`http://127.0.0.1:${port}/api${path}`,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
    const type=response.headers.get('content-type')||'';
    return {status:response.status,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0],body:type.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer())};
  };
  const admin=await request('/auth/login','POST',{email:'make_a_ton@gmail.com',password:'makeaton123'});
  assert.equal(admin.status,200);
  assert.equal((await request('/staff','POST',{name:'Report Staff',email:'reports@brightloop.test',password:'ReportStaff!123'},admin.cookie)).status,200);
  const staff=await request('/auth/login','POST',{email:'reports@brightloop.test',password:'ReportStaff!123'});
  assert.equal(staff.status,200);

  const schema=await request('/reports/schema','GET',null,staff.cookie);
  assert.equal(schema.status,200);
  assert.ok(schema.body.datasets.some(item=>item.key==='subscriptions'));
  const report=await request('/reports/xlsx','POST',{title:'Active subscription review',dataset:'subscriptions',fields:['number','customer','starts','recurringValue','status'],status:'Active',currency:'INR',dateFrom:'',dateTo:''},staff.cookie);
  assert.equal(report.status,200);
  assert.match(report.headers.get('content-type'),/spreadsheetml/);
  assert.match(report.headers.get('content-disposition'),/active-subscription-review-\d{4}-\d{2}-\d{2}\.xlsx/);
  assert.equal(report.body.subarray(0,2).toString(),'PK');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(report.body);
  const sheet=workbook.getWorksheet('Subscriptions');
  assert.ok(sheet);
  assert.equal(sheet.getCell('A1').value,'Active subscription review');
  assert.deepEqual(sheet.getRow(5).values.slice(1),['Subscription','Customer','Start date','Recurring value','Status']);
  assert.ok(sheet.rowCount>5);
  assert.equal(typeof sheet.getCell('D6').value,'number');
  assert.equal(sheet.getCell('E6').value,'Active');

  const invalid=await request('/reports/xlsx','POST',{title:'Bad report',dataset:'subscriptions',fields:['password']},staff.cookie);
  assert.equal(invalid.status,400);
  assert.match(invalid.body.error,/valid report column/i);
  assert.equal((await request('/auth/register','POST',{name:'Private Customer',email:'private@brightloop.test',password:'PrivateUser!123'})).status,200);
  const customer=await request('/auth/login','POST',{email:'private@brightloop.test',password:'PrivateUser!123'});
  assert.equal((await request('/reports/xlsx','POST',{title:'Forbidden',dataset:'customers',fields:['name']},customer.cookie)).status,403);
});
