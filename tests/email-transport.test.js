import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {createHash} from "node:crypto";
import {
 resolveEmailProvider,createResendTransport,createEmailTransport,qualifyMailError,
 formatEmailAddress,addressList,extractAddress,
 RESEND_MAX_ENCODED_ATTACHMENT_BYTES
} from "../email-transport.js";

test("resolveEmailProvider : historique SMTP, resend, disabled, invalide",()=>{
 assert.deepEqual(resolveEmailProvider({}),{provider:"disabled",mailEnabled:false});
 assert.equal(resolveEmailProvider({smtpHost:"smtp.example",from:"a@b.c",recipient:"c@d.e"}).provider,"smtp");
 assert.equal(resolveEmailProvider({emailProvider:"disabled"}).provider,"disabled");
 assert.equal(resolveEmailProvider({emailProvider:"resend",resendApiKey:"re_x",from:"a@b.c",recipient:"c@d.e"}).provider,"resend");
 assert.throws(()=>resolveEmailProvider({emailProvider:"resend",from:"a@b.c",recipient:"c@d.e"}),/RESEND_API_KEY/);
 assert.throws(()=>resolveEmailProvider({emailProvider:"smtp",from:"a@b.c",recipient:"c@d.e"}),/SMTP_HOST/);
 assert.throws(()=>resolveEmailProvider({emailProvider:"mailgun"}),/invalide/);
});

test("formatEmailAddress / Reply-To objets et chaines",()=>{
 assert.equal(formatEmailAddress("a@b.c"),"a@b.c");
 assert.equal(formatEmailAddress({address:"nolan@example.test",name:"Nolan"}), 'Nolan <nolan@example.test>');
 assert.equal(extractAddress('Nolan <nolan@example.test>'),"nolan@example.test");
 assert.deepEqual(addressList([{address:"a@b.c",name:"A"},"b@c.d"]),['A <a@b.c>',"b@c.d"]);
});

test("qualifyMailError : failed vs uncertain",()=>{
 assert.equal(qualifyMailError({uncertain:true,message:"x"}).state,"uncertain");
 assert.equal(qualifyMailError({code:"ETIMEDOUT",message:"t"}).state,"uncertain");
 assert.equal(qualifyMailError({status:401,message:"no"}).state,"failed");
 assert.equal(qualifyMailError({status:422,message:"bad"}).state,"failed");
 assert.equal(qualifyMailError({status:429,message:"quota"}).state,"failed");
 assert.equal(qualifyMailError({status:500,message:"oops"}).state,"uncertain");
 assert.equal(qualifyMailError({status:409,code:"concurrent_idempotent_requests",message:"busy"}).state,"uncertain");
 assert.equal(qualifyMailError({status:409,code:"invalid_idempotent_request",message:"diff"}).state,"failed");
});

test("createEmailTransport null si disabled",()=>{
 assert.equal(createEmailTransport({emailProvider:"disabled"}),null);
});

function startMock(handler){
 return new Promise(resolve=>{
  const server=http.createServer((req,res)=>handler(req,res,server));
  server.listen(0,"127.0.0.1",()=>resolve({
   server,
   url:"http://127.0.0.1:"+server.address().port+"/emails",
   close:()=>new Promise(r=>server.close(r))
  }));
 });
}

async function readJson(req){
 const chunks=[];for await(const c of req)chunks.push(c);
 return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}");
}

test("Resend HTTP : succes avec identifiant + accents",async()=>{
 const seen=[];
 const mock=await startMock(async(req,res)=>{
  seen.push({method:req.method,auth:Boolean(req.headers.authorization),key:req.headers["idempotency-key"]});
  const body=await readJson(req);
  assert.match(body.subject,/dossier/i);
  assert.match(body.text,/\u00e9t\u00e9|caf\u00e9|Majolane|Nolan/i);
  assert.equal(body.from, 'AEM <noreply@aem.example>');
  assert.deepEqual(body.to,['Admin <aemseve@gmail.com>']);
  assert.equal(body.reply_to, 'Nolan <nolan@example.test>');
  res.writeHead(200,{"Content-Type":"application/json"});
  res.end(JSON.stringify({id:"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}));
 });
 try{
  const t=createResendTransport({resendApiKey:"re_test",emailTimeoutMs:5000},{endpoint:mock.url});
  const result=await t.sendMail({
   from:{name:"AEM",address:"noreply@aem.example"},
   to:{name:"Admin",address:"aemseve@gmail.com"},
   replyTo:{name:"Nolan",address:"nolan@example.test"},
   subject:"[AEM Admin] Nouveau dossier \u2014 caf\u00e9 \u00e9t\u00e9",
   text:"Bonjour, le dossier de Nolan a \u00e9t\u00e9 re\u00e7u.",
   idempotencyKey:"aem-admin-notify/test-1"
  });
  assert.equal(result.id,"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794");
  assert.ok(result.accepted.includes("aemseve@gmail.com"));
  assert.equal(seen[0].key,"aem-admin-notify/test-1");
  assert.ok(seen[0].auth);
 }finally{await mock.close();}
});

test("Resend HTTP : 401 / 422 / 429 / 409 / 500 / 2xx sans id / timeout",async()=>{
 async function once(status,body,headers={}){
  const mock=await startMock(async(req,res)=>{
   await readJson(req);
   res.writeHead(status,{"Content-Type":"application/json",...headers});
   if(body===null){res.end("");return;}
   res.end(typeof body==="string"?body:JSON.stringify(body));
  });
  try{
   const t=createResendTransport({resendApiKey:"re_test",emailTimeoutMs:2000},{endpoint:mock.url});
   return await t.sendMail({from:"a@b.c",to:"c@d.e",subject:"s",text:"t"});
  }finally{await mock.close();}
 }
 await assert.rejects(()=>once(401,{message:"Missing API key",name:"missing_api_key"}),e=>e.status===401 && qualifyMailError(e).state==="failed");
 await assert.rejects(()=>once(422,{message:"invalid",name:"validation_error"}),e=>e.status===422);
 await assert.rejects(()=>once(429,{message:"rate",name:"rate_limit_exceeded"},{"retry-after":"10"}),e=>e.status===429 && e.retryAfter==="10");
 await assert.rejects(()=>once(409,{message:"payload changed",name:"invalid_idempotent_request"}),e=>qualifyMailError(e).state==="failed");
 await assert.rejects(()=>once(409,{message:"in progress",name:"concurrent_idempotent_requests"}),e=>qualifyMailError(e).state==="uncertain");
 await assert.rejects(()=>once(503,{message:"down"}),e=>qualifyMailError(e).state==="uncertain");
 await assert.rejects(()=>once(200,null),e=>e.uncertain===true);
 await assert.rejects(()=>once(200,"not-json"),e=>e.uncertain===true);

 const hang=await startMock(()=>{ /* never respond */ });
 try{
  const t=createResendTransport({resendApiKey:"re_test",emailTimeoutMs:50},{endpoint:hang.url});
  await assert.rejects(()=>t.sendMail({from:"a@b.c",to:"c@d.e",subject:"s",text:"t"}),e=>e.uncertain===true);
 }finally{await hang.close();}
});

test("Resend HTTP : idempotence meme cle+contenu ; conflit si contenu different",async()=>{
 const bodies=[];
 const mock=await startMock(async(req,res)=>{
  const body=await readJson(req);
  bodies.push({key:req.headers["idempotency-key"],subject:body.subject});
  if(bodies.length===1){
   res.writeHead(200,{"Content-Type":"application/json"});
   res.end(JSON.stringify({id:"id-1"}));
   return;
  }
  if(bodies[0].subject===body.subject && bodies[0].key===req.headers["idempotency-key"]){
   res.writeHead(200,{"Content-Type":"application/json"});
   res.end(JSON.stringify({id:"id-1"}));
   return;
  }
  res.writeHead(409,{"Content-Type":"application/json"});
  res.end(JSON.stringify({name:"invalid_idempotent_request",message:"payload mismatch"}));
 });
 try{
  const t=createResendTransport({resendApiKey:"re_test"},{endpoint:mock.url});
  const mail={from:"a@b.c",to:"c@d.e",subject:"same",text:"body",idempotencyKey:"op/1"};
  assert.equal((await t.sendMail(mail)).id,"id-1");
  assert.equal((await t.sendMail(mail)).id,"id-1");
  await assert.rejects(()=>t.sendMail({...mail,subject:"other"}),e=>e.status===409);
 }finally{await mock.close();}
});

test("Resend pieces jointes : Buffer encode ; refus path ; limite encodage",async()=>{
 const mock=await startMock(async(req,res)=>{
  const body=await readJson(req);
  assert.equal(body.attachments[0].filename,"doc.pdf");
  assert.ok(body.attachments[0].content);
  res.writeHead(200,{"Content-Type":"application/json"});
  res.end(JSON.stringify({id:"att-1"}));
 });
 try{
  const t=createResendTransport({resendApiKey:"re_test"},{endpoint:mock.url});
  const ok=await t.sendMail({
   from:"a@b.c",to:"c@d.e",subject:"s",text:"t",
   attachments:[{filename:"doc.pdf",content:Buffer.from("%PDF"),contentType:"application/pdf"}]
  });
  assert.equal(ok.id,"att-1");
  await assert.rejects(()=>t.sendMail({
   from:"a@b.c",to:"c@d.e",subject:"s",text:"t",
   attachments:[{filename:"x.pdf",path:"/etc/passwd"}]
  }),/interdits/);
 }finally{await mock.close();}
 const huge=Buffer.alloc(Math.ceil(RESEND_MAX_ENCODED_ATTACHMENT_BYTES*0.8));
 const mock2=await startMock(async(req,res)=>{await readJson(req);res.writeHead(200);res.end(JSON.stringify({id:"x"}));});
 try{
  const t=createResendTransport({resendApiKey:"re_test"},{endpoint:mock2.url});
  await assert.rejects(()=>t.sendMail({
   from:"a@b.c",to:"c@d.e",subject:"s",text:"t",
   attachments:[{filename:"a.bin",content:huge},{filename:"b.bin",content:huge}]
  }),/40 Mo/);
 }finally{await mock2.close();}
});

test("stabilite empreinte enveloppe (cle operation)",()=>{
 const env={subject:"S",text:"T",html:"",from:"a@b.c",to:"c@d.e",replyTo:{address:"r@e.f",name:"R"},deferredLabels:["JDC"],attachmentsEnabled:false,attachmentNames:[]};
 const hash=createHash("sha256").update([
  env.subject,env.text,env.html,env.from,env.to,env.replyTo.address,env.replyTo.name,env.deferredLabels.join("|"),"false",""
 ].join("\n")).digest("hex");
 assert.equal(hash.length,64);
 assert.equal(createHash("sha256").update([
  env.subject,env.text,env.html,env.from,env.to,env.replyTo.address,env.replyTo.name,env.deferredLabels.join("|"),"false",""
 ].join("\n")).digest("hex"),hash);
});

