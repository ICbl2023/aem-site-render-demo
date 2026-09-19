import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {chromium} from "playwright";
import {createApp} from "../server.js";

const root = path.resolve(".");
const boot = await readFile(path.join(root, "draft-boot.js"), "utf8");

test("draft-boot : capture #r= sans script inline (CSP script-src self)", async () => {
  assert.match(boot, /aem-draft-hash/);
  assert.match(boot, /sessionStorage\.setItem/);
  for (const page of ["ants.html", "permis.html"]) {
    const html = await readFile(path.join(root, page), "utf8");
    assert.match(html, /src="draft-boot\.js/);
    assert.doesNotMatch(html, /sessionStorage\.setItem\("aem-draft-hash"/);
    assert.doesNotMatch(html, /onclick=/);
  }
});

test("draft-boot : le jeton survit à un clic brand avant le chargement des modules", async () => {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(".browser-cache");
  const dataDir = path.resolve("test-results", "draft-boot-" + crypto.randomUUID());
  const app = createApp({
    config: {
      origin: "http://127.0.0.1",
      dataDir,
      draftDir: dataDir + "-brouillons",
      receiptDir: dataDir + "-receipts",
      adminAccounts: "test:test:responsable",
      candidateMail: false,
      retentionDays: 0,
    },
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.address().port;
  const token = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee." + "A".repeat(43);
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  try {
    const page = await browser.newPage();
    await page.route("**/app.js*", (route) => route.abort());
    await page.route("**/draft-remote.js*", (route) => route.abort());
    await page.route("**/drafts.js*", (route) => route.abort());
    await page.route("**/scene.js*", (route) => route.abort());
    await page.goto(base + "/ants.html#r=" + token, { waitUntil: "domcontentloaded" });
    const before = await page.evaluate(() => ({
      hash: location.hash,
      stored: sessionStorage.getItem("aem-draft-hash"),
    }));
    assert.equal(before.stored, token, "draft-boot doit mémoriser le jeton immédiatement");
    await page.locator("a.brand").click();
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => ({
      hash: location.hash,
      stored: sessionStorage.getItem("aem-draft-hash"),
    }));
    assert.equal(after.stored, token, "le jeton reste en sessionStorage après clic brand");
    assert.ok(
      after.stored === token || after.hash.includes("r=" + token),
      "reprise toujours possible via sessionStorage ou hash"
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => app.close(resolve));
  }
});