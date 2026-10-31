import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import nodemailer from 'nodemailer';

test('email OTP verifies every role, grants reset-only proof, changes password and signs in once',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'brightloop-otp-test-')),messages=[],original=nodemailer.createTransport;let failMail=false;
 nodemailer.createTransport=()=>({sendMail:async m=>{if(failMail)throw Object.assign(new Error('Mock failure'),{code:'EAUTH'});messages.push(m);}});
 Object.assign(process.env,{PORT:'0',DATA_DIR:dir,APP_URL:'http://localhost:3000',BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',BOOTSTRAP_ADMIN_PASSWORD:'AdminPass!42',SMTP_HOST:'mock-smtp',MAIL_FROM:'no-reply@example.test',DEV_RESET_LINKS:'false',ENABLE_DEMO_CHECKOUT:'false'});
 const {server,db}=await import('../server.js?suite=otp-recovery');if(!server.listening)await once(server,'listening');
 t.after(async()=>{await new Promise(r=>server.close(r));nodemailer.createTransport=original;rmSync(dir,{recursive:true,force:true});});
 const call=async(path,body,cookie,method=body?'POST':'GET')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const admin=(await call('/auth/login',{email:'admin@example.test',password:'AdminPass!42'})).cookie;
 assert.equal((await call('/staff',{name:'Staff',email:'staff@example.test',password:'StaffPass!42'},admin)).status,200);
 assert.equal((await call('/auth/register',{name:'Customer',email:'customer@example.test',password:'CustomerPass!42'})).status,200);
 const code=()=>messages.at(-1).text.match(/\b\d{6}\b/)[0];
 for(const [role,email,password] of [['customer','customer@example.test','CustomerPass!42'],['staff','staff@example.test','StaffPass!42'],['admin','admin@example.test','AdminPass!42']]){
  const old=(await call('/auth/login',{email,password})).cookie;
  const sent=await call('/auth/forgot',{email});assert.equal(sent.status,200);assert.equal(messages.at(-1).to,email);assert.ok(!messages.at(-1).text.includes('?reset='));const otp=code();
  const verify=await call('/auth/otp/verify',{email,otp});assert.equal(verify.status,200);assert.match(verify.body.recoveryToken,/^[a-f0-9]{64}$/);assert.equal(verify.cookie,undefined);
  assert.equal((await call('/state',null,undefined)).status,401,'Email verification alone must not grant workspace access');
  assert.equal((await call('/auth/otp/verify',{email,otp})).status,400,'The code is consumed once');
  const result=await call('/auth/otp/reset',{recoveryToken:verify.body.recoveryToken,password:'RecoveredPass!42',role:'admin'});assert.equal(result.status,200);assert.equal(result.body.user.role,role);assert.ok(result.cookie);
  assert.equal((await call('/auth/me',null,result.cookie)).body.user.email,email);assert.equal((await call('/state',null,old)).status,401);
  assert.equal((await call('/auth/otp/reset',{recoveryToken:verify.body.recoveryToken,password:'OtherPass!42'})).status,400);
 }
 const originalNow=Date.now;Date.now=()=>originalNow()+900001;t.after(()=>{Date.now=originalNow;});
 await call('/auth/otp/send',{email:'customer@example.test'});const expiredCode=code();db.prepare('UPDATE otps SET expires=0 WHERE email=?').run('customer@example.test');assert.equal((await call('/auth/otp/verify',{email:'customer@example.test',otp:expiredCode})).status,400);
 await call('/auth/otp/send',{email:'customer@example.test'});const correct=code();for(let i=0;i<5;i++)assert.equal((await call('/auth/otp/verify',{email:'customer@example.test',otp:'000000'})).status,400);assert.equal((await call('/auth/otp/verify',{email:'customer@example.test',otp:correct})).status,400);
 await call('/auth/otp/send',{email:'customer@example.test'});const proof=(await call('/auth/otp/verify',{email:'customer@example.test',otp:code()})).body.recoveryToken;db.prepare('UPDATE recoveries SET expires=0').run();assert.equal((await call('/auth/otp/reset',{recoveryToken:proof,password:'AnotherPass!42'})).status,400);
 const before=messages.length;assert.equal((await call('/auth/otp/send',{email:'absent@example.test'})).status,200);assert.equal(messages.length,before);
 failMail=true;assert.equal((await call('/auth/otp/send',{email:'customer@example.test'})).status,503);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM otps WHERE email=?').get('customer@example.test').n,0);
 process.env.SMTP_HOST='smtp.gmail.com';process.env.SMTP_USER='';process.env.SMTP_PASS='';assert.equal((await call('/auth/otp/send',{email:'customer@example.test'})).status,503);
});
