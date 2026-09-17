import test from "node:test";
import assert from "node:assert/strict";
import {startHarness} from "./helpers.js";

// Fichiers déposés par AEM (photos, voix) et archive de livraison : servis s'ils existent, jamais hors de leur dossier.
test("Photos, voix et livraison : servis à la demande, 404 sinon, pas de traversée de dossier",async()=>{
 const h=await startHarness();
 try{
 const get=async p=>fetch(h.url+"/"+p);
 let r=await get("voice/manifest.json");
 assert.equal(r.status,200);assert.match(r.headers.get("content-type"),/application\/json/);
 const manifest=await r.json();
 assert.ok(Object.keys(manifest).length>30,"le manifeste liste les phrases à enregistrer");
 assert.equal((await get("photos/facade.jpg")).status,404,"photo pas encore fournie");
 assert.equal((await get("photos/..%2Fserver.js")).status,404);
 assert.equal((await get("photos/server.js")).status,404,"extension non servie");
 assert.equal((await get("voice/manifest.json/../server.js")).status,404);
 assert.equal((await get("telechargement/inexistant.zip")).status,404);
 assert.equal((await get("telechargement/..%2F.env")).status,404);
 }finally{await h.close();}
});
