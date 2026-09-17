// Configuration exclusivement serveur. Aucun identifiant SMTP dans le navigateur.
import {limits} from "./logic.js";
export const config = {
 standalone: process.env.AEM_STANDALONE === "1",
 recipient: process.env.AEM_RECIPIENT || "",
 from: process.env.AEM_FROM || "",
 smtpHost: process.env.SMTP_HOST || "",
 smtpPort: Number(process.env.SMTP_PORT || 587),
 smtpUser: process.env.SMTP_USER || "",
 smtpPass: process.env.SMTP_PASS || "",
 origin: process.env.AEM_ORIGIN || process.env.RENDER_EXTERNAL_URL || "",
 basePath: (process.env.AEM_BASE_PATH || "").replace(/\/$/,""),
 host: process.env.HOST || "127.0.0.1",
 port: Number(process.env.PORT || 3000),
 receiptDir: process.env.AEM_RECEIPT_DIR || ".runtime",
 dataDir: process.env.AEM_DATA_DIR || ".data",
 draftDir: process.env.AEM_DRAFT_DIR || ".data-brouillons", // brouillons en cours, séparés des dossiers envoyés (durée de vie et accès différents)
 drafts: process.env.AEM_DRAFTS !== "0", // 0 = brouillon local au navigateur seulement, sans reprise d’un appareil à l’autre
 adminPassword: process.env.AEM_ADMIN_PASSWORD || "",
 adminAccounts: process.env.AEM_ADMIN_ACCOUNTS || "",
 adminPrefill: process.env.AEM_ADMIN_PREFILL || "", // phase de test seulement : "identifiant:motdepasse" prérempli à l’écran de connexion
 adminPasswordSalt: process.env.AEM_ADMIN_SALT || "", // vide : sel aléatoire généré et conservé dans <dataDir>/.admin/salt
 adminUrl: process.env.AEM_ADMIN_URL || "", // URL publique de l’espace admin (lien dans les mails de notification)
 candidateMail: process.env.AEM_CANDIDATE_MAIL !== "0",
 aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
 mailAttachments: process.env.AEM_MAIL_ATTACHMENTS === "1",
 retentionDays: Number(process.env.AEM_RETENTION_DAYS || 365),
 trustProxy: process.env.TRUST_PROXY === "1",
 limits
};
