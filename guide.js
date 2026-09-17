// Guide d'orientation partagé (navigateur et serveur) : actions du site et réponses par mots-clés, sans dépendance.
export const SITE_ACTIONS={
 inscription:{label:"Préparer mon dossier ANTS",href:"./inscription.html"},
 ants:{label:"Commencer le dossier ANTS",href:"./ants.html"},
 permis:{label:"Fabrication du permis",href:"./permis.html"},
 apres:{label:"Après l’examen",href:"./apres-examen.html"},
 formations:{label:"Voir les formations",href:"./formations.html"},
 tarifs:{label:"Voir les tarifs",href:"./tarifs.html"},
 rdv:{label:"Prendre rendez-vous",href:"./rendez-vous.html"},
 email:{label:"Écrire un e-mail à AEM",href:"mailto:aem69330@gmail.com?subject=Demande%20d%E2%80%99information"},
 contact:{label:"Nous contacter",href:"./contact.html"},
 horaires:{label:"Horaires d’ouverture",href:"./contact.html#horaires"},
 telephone:{label:"Appeler le 04 78 31 79 85",href:"tel:+33478317985"}
};
export const ACTION_IDS=Object.keys(SITE_ACTIONS);

const KEYWORDS=[
 [/horaire|ouvert|ouvrez|ferm[ée]|heures? d.ouverture|[àa] quelle heure/i,"Le bureau est ouvert le lundi de 14 h à 19 h, du mardi au vendredi de 10 h à 12 h et de 14 h à 19 h, et le samedi de 10 h à 12 h. Les leçons de conduite ont lieu du lundi au vendredi de 8 h à 19 h.",["horaires","telephone"]],
 [/automati.*(tarif|prix|co[uû]t|combien)|(tarif|prix|co[uû]t|combien).*automati/i,"Le forfait boîte automatique n’est pas affiché sur le site : il est établi sur devis après l’évaluation de départ. Les forfaits affichés (1389 € permis B, 1499 € conduite accompagnée) concernent la boîte manuelle.",["tarifs","telephone"]],
 [/tarif|prix|co[uû]t|combien|paiement|financ|1 ?€|euro par jour|cpf/i,"Les forfaits affichés sont de 1389 € pour le permis B en boîte manuelle et 1499 € pour la conduite accompagnée (boîte manuelle), avec paiement en trois fois sans frais ; le permis à 1 € par jour aide les 15 à 25 ans. Boîte automatique, heures supplémentaires et post-permis : sur devis après l’évaluation de départ.",["tarifs","contact"]],
 [/accompagn|aac|15 ans|supervis/i,"La conduite accompagnée (AAC) est accessible dès 15 ans ; la conduite supervisée dès 18 ans après 20 h de conduite et le code, avec un rendez-vous préalable de 2 h.",["formations","inscription"]],
 [/inscri|commencer|dossier ants|(?<!\p{L})ants(?!\p{L})|(?<!\p{L})neph(?!\p{L})|s.inscrire/iu,"Pour s’inscrire, vous constituez votre dossier ANTS en ligne : quelques questions, vos pièces en photo ou en PDF, et l’équipe AEM vérifie tout avant de déposer la démarche.",["inscription","ants"]],
 [/fabrication|titre|réussi|reçu|apr[eè]s l.examen|renouvel|perdu|vol[ée]|ab[iî]m[ée]|carte permis/i,"Après la réussite à l’examen, la fabrication du permis se prépare en ligne avec votre pièce d’identité, votre certificat d’examen (CEPC) pour un premier permis ou votre permis actuel pour un renouvellement, un justificatif de domicile et, si besoin, un avis médical.",["apres","permis"]],
 [/automati|bo[iî]te|manuel|acc[ée]l[ée]r|4 semaines/i,"Vous pouvez passer le permis en boîte automatique (forfait sur devis après l’évaluation, non affiché sur le site) et le transformer en permis boîte mécanique sans délai ni examen ; une formation accélérée en 4 semaines est possible après entretien.",["formations","contact"]],
 [/code|théori|samedi|etg/i,"Le code (épreuve théorique générale) se prépare avec un accès au site Codes Rousseau offert et des cours thématiques le samedi de 13 h à 16 h sur inscription.",["formations","horaires"]],
 [/handicap|mobilit|pmr|mdph/i,"AEM n’est pas spécialisée dans les formations adaptées au handicap ; l’équipe peut vous orienter vers la MDPH et des auto-écoles équipées. Appelez-nous pour en parler.",["telephone","contact"]],
 [/rendez|rdv|cr[ée]neau|disponib/i,"Pour un rendez-vous (évaluation de départ, entretien, inscription), appelez le 04 78 31 79 85 ou écrivez-nous depuis la page Rendez-vous : l’e-mail est prérempli avec le motif.",["rdv","telephone"]],
 [/adresse|(?<!\p{L})où(?!\p{L})|venir|tram|acc[eè]s|t[ée]l[ée]phone|e-?mail|courriel|(?<!\p{L})mail(?!\p{L})|contact|joindre|appeler/iu,"L’agence est au 46 rue de la République à Meyzieu. Vous pouvez appeler le 04 78 31 79 85 ou écrire à aem69330@gmail.com.",["contact","telephone"]],
 [/formation|permis b|apprendre|le[cç]on/i,"AEM propose le permis B en boîte manuelle ou automatique, la conduite accompagnée, la conduite supervisée, la formation accélérée et la formation post-permis.",["formations","inscription"]]
];
export function guideReply(text){
 for(const [re,reply,actions] of KEYWORDS)if(re.test(text))return {reply,actions,source:"guide"};
 return {reply:"Je ne suis pas sûr de bien comprendre. Je peux vous orienter vers les formations, la préparation du dossier ANTS, la fabrication du permis, les tarifs, les horaires ou un rendez-vous ; pour toute autre question, l’équipe répond au téléphone ou par e-mail.",actions:["telephone","email","formations"],source:"guide"};
}

