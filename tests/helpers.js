import {SMTPServer} from "smtp-server";
import nodemailer from "nodemailer";
import {simpleParser} from "mailparser";
import {createApp} from "../server.js";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {documentsFor} from "../logic.js";
 export const candidate={workflow:"ants",permitType:"renewal",birthName:"GRAYSON",firstName:"Nolan",birthDate:"2006-03-12",nationality:"francaise",identityDocument:"cni_fr",identityExpiry:"2030-05-12",phone:"0600000000",email:"nolan@example.test",home:"parents",homeProof:"facture",homeDate:"2026-08",special:"non",contactName:"Parent Exemple",contactPhone:"0600000002"};
export const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=","base64");
export const pdf=Buffer.from("%PDF-1.4\n% DOCUMENT FICTIF DE TEST AEM\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
export const heic=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from("ftypheic"),Buffer.from([0,0,0,0]),Buffer.from("mif1heic")]);
export function attachmentsFor(answers=candidate){
 const keys=documentsFor(answers).filter(d=>d.requiredUpload).map(d=>d.key);
 return keys.map((key,index)=>({key,name:key.replace(/_/g,"-")+"-"+index+".pdf",content:pdf}));
}
export async function startHarness({port=0,...overrides}={}){
 const messages=[],rawMessages=[];
 const smtp=new SMTPServer({disabledCommands:["AUTH","STARTTLS"],onData(stream,session,callback){
 const chunks=[];stream.on("data",c=>chunks.push(c));stream.on("end",async()=>{
 try{const raw=Buffer.concat(chunks);rawMessages.push(raw);messages.push(await simpleParser(raw));callback();}catch(e){callback(e);}
 });
 }});
 await new Promise(r=>smtp.listen(0,"127.0.0.1",r));
 const transport=nodemailer.createTransport({host:"127.0.0.1",port:smtp.server.address().port,secure:false,ignoreTLS:true,allowInternalNetworkInterfaces:true});
 const receiptDir=path.resolve("test-results","receipts-"+crypto.randomUUID());
 const dataDir=path.resolve("test-results","data-"+crypto.randomUUID());
 await mkdir(receiptDir,{recursive:true});await mkdir(dataDir,{recursive:true});
 const origin="http://127.0.0.1"+(port?":"+port:"");
 const app=createApp({config:{origin,from:"aem@example.test",recipient:"admin@example.test",receiptDir,dataDir,adminPassword:"test-admin",candidateMail:false,...overrides},transport});
 await new Promise(r=>app.listen(port,"127.0.0.1",r));
 const url="http://127.0.0.1:"+app.address().port;
 return {app,smtp,url,origin,dataDir,messages,rawMessages,async close(){await new Promise(r=>app.close(r));await new Promise(r=>smtp.close(r));}};
}
export function form(answers=candidate,attachments=attachmentsFor(answers),id=crypto.randomUUID()){
 const data=new FormData(),metadata=[];
 attachments.forEach((f,i)=>{const field="file_"+i;metadata.push({field,key:f.key,name:f.name,size:f.content.length});data.append(field,new Blob([f.content]),f.name);});
 data.append("payload",JSON.stringify({submissionId:id,answers,files:metadata}));data.append("website","");
 return data;
}
export async function send(h,data,origin=h.origin){return fetch(h.url+"/api/submit",{method:"POST",headers:{"Origin":origin,"X-AEM-Request":"questionnaire"},body:data});}
