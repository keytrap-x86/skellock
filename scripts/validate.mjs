import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

function readPngDimensions(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a", "invalid PNG signature");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

const manifest = await readJson("manifest.json");
const packageMetadata = await readJson("package.json");

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, "SiteLock");
assert.equal(manifest.description.length <= 132, true);
assert.equal(packageMetadata.version, manifest.version);
assert.equal(packageMetadata.name, "sitelock");
assert.deepEqual(manifest.permissions, [
  "storage",
  "declarativeNetRequestWithHostAccess",
]);
assert.equal("host_permissions" in manifest, false);
assert.deepEqual(manifest.optional_host_permissions, ["*://*/*"]);
assert.deepEqual(manifest.web_accessible_resources, [
  {
    resources: ["lock.html"],
    matches: ["*://*/*"],
  },
]);
assert.deepEqual(manifest.options_ui, {
  page: "options.html",
  open_in_tab: true,
});
assert.equal(manifest.action.default_popup, "popup.html");
assert.equal(manifest.incognito, "not_allowed");
assert.equal("declarative_net_request" in manifest, false);
assert.equal(
  manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"),
  false
);
assert.equal(
  manifest.content_security_policy.extension_pages.includes("'unsafe-inline'"),
  false
);

for (const referencedFile of [
  manifest.background.service_worker,
  manifest.options_ui.page,
  manifest.action.default_popup,
  manifest.web_accessible_resources[0].resources[0],
  "domain-utils.js",
  "auth.js",
]) {
  await access(resolve(root, referencedFile));
}

for (const size of [16, 32, 48, 128]) {
  const path = resolve(root, `icons/icon-${size}.png`);
  const dimensions = readPngDimensions(await readFile(path));
  assert.deepEqual(dimensions, { width: size, height: size });
}

for (const [path, expectedDimensions] of [
  ["store-assets/promo-440x280.png", { width: 440, height: 280 }],
  ["store-assets/marquee-1400x560.png", { width: 1400, height: 560 }],
  [
    "store-assets/screenshot-lock-1280x800.png",
    { width: 1280, height: 800 },
  ],
]) {
  const dimensions = readPngDimensions(await readFile(resolve(root, path)));
  assert.deepEqual(dimensions, expectedDimensions);
}

for (const asset of [
  "store-assets/promo-440x280.png",
  "store-assets/marquee-1400x560.png",
  "store-assets/screenshot-lock-1280x800.png",
]) {
  const png = await readFile(resolve(root, asset));
  assert.equal(png[24], 8, `${asset} must use 8 bits per channel`);
  assert.equal(png[25], 2, `${asset} must be RGB without an alpha channel`);
}

for (const htmlFile of ["lock.html", "options.html", "popup.html"]) {
  const html = await readFile(resolve(root, htmlFile), "utf8");
  assert.equal(
    /<script[^>]+src=["']https?:/i.test(html),
    false,
    `${htmlFile} loads remote code`
  );
  assert.equal(
    /<script(?![^>]+src=)/i.test(html),
    false,
    `${htmlFile} contains inline code`
  );
}

const lockHtml = await readFile(resolve(root, "lock.html"), "utf8");
const lockScript = await readFile(resolve(root, "script.js"), "utf8");
assert.equal(
  lockHtml.includes("openSettingsButton"),
  false,
  "lock page must not expose a settings shortcut"
);
assert.equal(
  /id=["']passwordInput["'][^>]*\bautofocus\b/.test(lockHtml),
  true,
  "lock password input must request focus"
);
assert.equal(
  /\b(?:HHMM|MMHH|clock|horloge|heure|minute|1423|2314)\b/i.test(
    `${lockHtml}\n${lockScript}`
  ),
  false,
  "lock page must not reveal how dynamic codes are derived"
);

for (const scriptFile of [
  "background.js",
  "domain-utils.js",
  "auth.js",
  "script.js",
  "options.js",
  "popup.js",
]) {
  const source = await readFile(resolve(root, scriptFile), "utf8");
  assert.equal(/\beval\s*\(/.test(source), false, `${scriptFile} uses eval`);
  assert.equal(
    /\bnew\s+Function\s*\(/.test(source),
    false,
    `${scriptFile} uses new Function`
  );
}

const background = await readFile(resolve(root, "background.js"), "utf8");
assert.equal(background.includes("updateDynamicRules"), true);
assert.equal(background.includes("updateSessionRules"), true);
assert.equal(background.includes("chrome.storage.sync"), true);
assert.equal(background.includes("chrome.permissions"), true);
assert.equal(background.includes("expectedReverseAccessCode"), true);

console.log(
  `SiteLock ${manifest.version}: manifest and package inputs are valid.`
);
