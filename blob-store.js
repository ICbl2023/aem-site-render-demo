// Couche blob : octets des pieces. Les meta.json restent sur disque local.
// Drivers : legacy-fs (defaut, fichiers a cote de meta), memory (tests), local, r2 (bucket prive).
import {mkdir,readFile,writeFile,unlink,rm,readdir} from "node:fs/promises";
import path from "node:path";

export function dossierFileKey(id,storedAs){return "dossiers/"+id+"/files/"+storedAs;}
export function draftFileKey(draftId,storedAs){return "brouillons/"+draftId+"/files/"+storedAs;}
export function dossierPrefix(id){return "dossiers/"+id+"/";}
export function draftPrefix(draftId){return "brouillons/"+draftId+"/";}

function assertKey(key){
 if(typeof key!=="string" || !key || key.includes("..") || key.startsWith("/") || key.includes("\\")){
  throw new Error("Cle de stockage invalide.");
 }
 return key;
}

export function createMemoryBlobStore(seed=new Map()){
 const objects=new Map(seed);
 return {
  driver:"memory",
  async put(key,body,{contentType="application/octet-stream"}={}){
   assertKey(key);
   const buf=Buffer.isBuffer(body)?body:Buffer.from(body);
   objects.set(key,{body:buf,contentType,size:buf.length});
  },
  async get(key){
   assertKey(key);
   const hit=objects.get(key);
   return hit?{body:Buffer.from(hit.body),contentType:hit.contentType,size:hit.size}:null;
  },
  async remove(key){assertKey(key);objects.delete(key);},
  async removePrefix(prefix){
   const p=prefix.endsWith("/")?prefix:prefix+"/";
   assertKey(p.slice(0,-1)||"x");
   let n=0;
   for(const key of [...objects.keys()])if(key.startsWith(p)||key===prefix.replace(/\/$/,"")){objects.delete(key);n++;}
   return n;
  },
  async list(prefix=""){
   return [...objects.keys()].filter(k=>!prefix||k.startsWith(prefix)).sort();
  },
  _objects:objects
 };
}

export function createLocalBlobStore(localRoot){
 const root=path.resolve(localRoot);
 return {
  driver:"local",
  root,
  async put(key,body,{contentType="application/octet-stream"}={}){
   assertKey(key);
   const target=path.join(root,...key.split("/"));
   await mkdir(path.dirname(target),{recursive:true,mode:0o700});
   await writeFile(target,body,{mode:0o600});
   void contentType;
  },
  async get(key){
   assertKey(key);
   try{
    const body=await readFile(path.join(root,...key.split("/")));
    return {body,contentType:"application/octet-stream",size:body.length};
   }catch(e){if(e.code==="ENOENT")return null;throw e;}
  },
  async remove(key){
   assertKey(key);
   await unlink(path.join(root,...key.split("/"))).catch(e=>{if(e.code!=="ENOENT")throw e;});
  },
  async removePrefix(prefix){
   const rel=prefix.replace(/\/$/,"");
   assertKey(rel||"x");
   await rm(path.join(root,...rel.split("/")),{recursive:true,force:true});
   return 1;
  },
  async list(prefix=""){
   const out=[];
   async function walk(dir,rel=""){
    for(const ent of await readdir(dir,{withFileTypes:true}).catch(()=>[])){
     const next=rel?rel+"/"+ent.name:ent.name;
     if(ent.isDirectory())await walk(path.join(dir,ent.name),next);
     else if(!prefix||next.startsWith(prefix))out.push(next);
    }
   }
   await walk(root);
   return out.sort();
  }
 };
}

// Historique : fichiers sous <dataDir>/<id>/files/ a cote de meta.json (tests et mode sans R2).
export function createLegacyFsBlobStore(dataDir){
 const root=path.resolve(dataDir);
 return {
  driver:"legacy-fs",
  root,
  async putFile(id,storedAs,body){
   const dir=path.join(root,id,"files");
   await mkdir(dir,{recursive:true,mode:0o700});
   await writeFile(path.join(dir,storedAs),body,{mode:0o600});
  },
  async getFile(id,storedAs){
   try{return await readFile(path.join(root,id,"files",storedAs));}
   catch(e){if(e.code==="ENOENT")return null;throw e;}
  },
  async removeFile(id,storedAs){
   await unlink(path.join(root,id,"files",storedAs)).catch(e=>{if(e.code!=="ENOENT")throw e;});
  },
  async removeAll(id){
   await rm(path.join(root,id,"files"),{recursive:true,force:true});
  }
 };
}

export function createFileBlobs(backend,{scope}){
 if(backend?.putFile)return backend;
 const prefix=scope==="brouillons"?"brouillons/":"dossiers/";
 return {
  driver:backend.driver,
  async putFile(id,storedAs,body,contentType){
   await backend.put(prefix+id+"/files/"+storedAs,body,{contentType:contentType||"application/octet-stream"});
  },
  async getFile(id,storedAs){
   const hit=await backend.get(prefix+id+"/files/"+storedAs);
   return hit?hit.body:null;
  },
  async removeFile(id,storedAs){
   await backend.remove(prefix+id+"/files/"+storedAs);
  },
  async removeAll(id){
   await backend.removePrefix(prefix+id+"/");
  }
 };
}

export async function createR2BlobStore({
 endpoint,accessKeyId,secretAccessKey,bucket,prefix="",region="auto"
}={}){
 if(!endpoint||!accessKeyId||!secretAccessKey||!bucket){
  throw new Error("Configuration R2 incomplete (endpoint, cles, bucket).");
 }
 const {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand,ListObjectsV2Command,DeleteObjectsCommand}=await import("@aws-sdk/client-s3");
 const client=new S3Client({
  region:region||"auto",
  endpoint,
  credentials:{accessKeyId,secretAccessKey},
  forcePathStyle:true
 });
 const base=(prefix||"").replace(/^\/+|\/+$/g,"");
 const fullKey=key=>{assertKey(key);return base?base+"/"+key:key;};
 return {
  driver:"r2",
  bucket,
  async put(key,body,{contentType="application/octet-stream"}={}){
   const buf=Buffer.isBuffer(body)?body:Buffer.from(body);
   await client.send(new PutObjectCommand({
    Bucket:bucket,Key:fullKey(key),Body:buf,ContentType:contentType,ContentLength:buf.length
   }));
  },
  async get(key){
   try{
    const out=await client.send(new GetObjectCommand({Bucket:bucket,Key:fullKey(key)}));
    const bytes=Buffer.from(await out.Body.transformToByteArray());
    return {body:bytes,contentType:out.ContentType||"application/octet-stream",size:bytes.length};
   }catch(e){
    if(e.name==="NoSuchKey"||e.$metadata?.httpStatusCode===404)return null;
    throw e;
   }
  },
  async remove(key){
   await client.send(new DeleteObjectCommand({Bucket:bucket,Key:fullKey(key)}));
  },
  async removePrefix(prefixKey){
   const p=fullKey(prefixKey.endsWith("/")?prefixKey:prefixKey+"/");
   let token,removed=0;
   do{
    const listed=await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:p,ContinuationToken:token}));
    const objects=(listed.Contents||[]).map(o=>({Key:o.Key})).filter(o=>o.Key);
    if(objects.length){
     await client.send(new DeleteObjectsCommand({Bucket:bucket,Delete:{Objects:objects,Quiet:true}}));
     removed+=objects.length;
    }
    token=listed.IsTruncated?listed.NextContinuationToken:undefined;
   }while(token);
   return removed;
  },
  async list(prefixKey=""){
   const p=fullKey(prefixKey);
   const keys=[];
   let token;
   do{
    const listed=await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:p,ContinuationToken:token}));
    for(const o of listed.Contents||[]){
     if(!o.Key)continue;
     keys.push(base?o.Key.slice(base.length+1):o.Key);
    }
    token=listed.IsTruncated?listed.NextContinuationToken:undefined;
   }while(token);
   return keys.sort();
  }
 };
}

export async function createBlobStoreFromConfig(config={}){
 const driver=String(config.blobDriver||"local").toLowerCase();
 if(driver==="memory")return createMemoryBlobStore();
 if(driver==="r2"){
  return createR2BlobStore({
   endpoint:config.r2Endpoint||"",
   accessKeyId:config.r2AccessKeyId||"",
   secretAccessKey:config.r2SecretAccessKey||"",
   bucket:config.r2Bucket||"",
   prefix:config.r2Prefix||"aem",
   region:config.r2Region||"auto"
  });
 }
 if(config.blobDir)return createLocalBlobStore(config.blobDir);
 return null;
}
