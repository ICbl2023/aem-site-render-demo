#!/bin/sh
# Redéploie la démo AEM sur le VPS (hôte SSH « vps ») : archive du dernier commit, dépendances, redémarrage pm2.
# Usage : sh scripts/deploy-vps.sh   (le vhost nginx et le certificat existent déjà)
set -e
HOST=aem.148-113-172-3.nip.io
STAMP=$(date +%Y-%m-%d)
TOKEN=$(openssl rand -hex 4)
ZIP="aem-site-complet-$STAMP-$TOKEN.zip"
mkdir -p livraison
git archive --format=zip --prefix=site-aem/ -o "livraison/$ZIP" HEAD
scp -q "livraison/$ZIP" vps:/tmp/aem-site.zip
ssh vps "set -e; rm -rf /var/www/aem-site.new && mkdir -p /var/www/aem-site.new && cd /var/www/aem-site.new && unzip -q -o /tmp/aem-site.zip && cp -a site-aem/. . && rm -rf site-aem && mkdir -p livraison && cp /tmp/aem-site.zip livraison/$ZIP && cp -a /var/www/aem-site/livraison/. livraison/ 2>/dev/null || true && npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 && cd /var/www && (pm2 delete aem-demo >/dev/null 2>&1 || true) && rm -rf aem-site.old && ([ -d aem-site ] && mv aem-site aem-site.old || true) && mv aem-site.new aem-site && cd aem-site && ([ -d ../aem-site.old/.data-demo ] && cp -a ../aem-site.old/.data-demo . || true) && PORT=3010 AEM_ORIGIN=https://$HOST TRUST_PROXY=1 pm2 start scripts/start-demo.js --name aem-demo --time >/dev/null && pm2 save >/dev/null && sleep 3 && curl -s -o /dev/null -w 'site : %{http_code}\n' https://$HOST/index.html"
echo "Archive : https://$HOST/telechargement/$ZIP"
