// Configuration exclusivement serveur. Aucun identifiant SMTP dans le navigateur.
import {limits} from "./logic.js";
export const config = {
 standalone: process.env.AEM_STANDALONE === "1",
 recipient: process.env.AEM_RECIPIENT || "",
 from: process.env.AEM_FROM || "",
 // smtp | resend | disabled | vide (= SMTP historique si SMTP_HOST+FROM+RECIPIENT)
 emailProvider: process.env.AEM_EMAIL_PROVIDER || "",
 resendApiKey: process.env.RESEND_API_KEY || "",
 emailTimeoutMs: Number(process.env.AEM_EMAIL_TIMEOUT_MS || 15000),
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
 // 60 = conservation 2 mois des dossiers finalises (decision Luc). 0 = desactive.
 retentionDays: Number(process.env.AEM_RETENTION_DAYS ?? 60),
 trustProxy: process.env.TRUST_PROXY === "1",
 // local (défaut legacy-fs) | memory | r2 — les meta restent sur AEM_DATA_DIR / AEM_DRAFT_DIR
 blobDriver: process.env.AEM_BLOB_DRIVER || "local",
 blobDir: process.env.AEM_BLOB_DIR || "",
 r2Endpoint: process.env.AEM_R2_ENDPOINT || "",
 r2AccessKeyId: process.env.AEM_R2_ACCESS_KEY_ID || "",
 r2SecretAccessKey: process.env.AEM_R2_SECRET_ACCESS_KEY || "",
 r2Bucket: process.env.AEM_R2_BUCKET || "",
 r2Prefix: process.env.AEM_R2_PREFIX || "aem",
 r2Region: process.env.AEM_R2_REGION || "auto",
 limits
};
