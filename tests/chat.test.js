import test from "node:test";
import assert from "node:assert/strict";
import {guideReply} from "../guide.js";

// Le guide hors-ligne ne doit jamais laisser croire qu'un tarif existe pour la boîte automatique, ni oublier le certificat d'examen.
test("Guide : boîte automatique sur devis, forfaits affichés = boîte manuelle",()=>{
 for(const q of ["Combien coûte le permis en boîte automatique ?","Prix du forfait automatique","tarif boite auto"]){
  const r=guideReply(q);
  assert.ok(/devis/i.test(r.reply),q);
  assert.ok(!/1389 € pour le permis B en boîte manuelle et/.test(r.reply) || /devis/i.test(r.reply),q);
 }
 const prix=guideReply("Quels sont vos tarifs ?");
 assert.ok(/manuelle/.test(prix.reply) && /devis/.test(prix.reply) && /1389/.test(prix.reply));
 assert.ok(!/inscrire en ligne/i.test(guideReply("blabla").reply));
});
test("Guide : fabrication du permis, certificat d’examen pour un premier permis",()=>{
 const r=guideReply("J’ai réussi mon examen, comment avoir mon permis ?");
 assert.ok(/CEPC/.test(r.reply) && /renouvellement/.test(r.reply));
 assert.ok(!/inscription en ligne/i.test(guideReply("je veux commencer").reply));
});
