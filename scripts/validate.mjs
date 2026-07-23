import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
const rules = await readJson("rules.json");
const packageMetadata = await readJson("package.json");

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.description.length <= 132, true);
assert.equal(packageMetadata.version, manifest.version);
assert.deepEqual(manifest.permissions, [
  "declarativeNetRequestWithHostAccess",
]);
assert.deepEqual(manifest.host_permissions, ["https://*.skello.io/*"]);
assert.deepEqual(manifest.web_accessible_resources, [
  {
    resources: ["lock.html"],
    matches: ["https://*.skello.io/*"],
  },
]);
assert.equal(manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"), false);
assert.equal(manifest.content_security_policy.extension_pages.includes("'unsafe-inline'"), false);

assert.equal(rules.length, 1);
assert.equal(rules[0].action.type, "redirect");
assert.equal(rules[0].condition.urlFilter, "||skello.io^");
assert.deepEqual(rules[0].condition.resourceTypes, ["main_frame"]);

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

const marquee = await readFile(
  resolve(root, "store-assets/marquee-1400x560.png")
);
assert.equal(marquee[24], 8, "marquee must use 8 bits per channel");
assert.equal(marquee[25], 2, "marquee must be RGB without an alpha channel");

for (const htmlFile of ["lock.html"]) {
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

for (const scriptFile of ["background.js", "script.js"]) {
  const source = await readFile(resolve(root, scriptFile), "utf8");
  assert.equal(/\beval\s*\(/.test(source), false, `${scriptFile} uses eval`);
  assert.equal(
    /\bnew\s+Function\s*\(/.test(source),
    false,
    `${scriptFile} uses new Function`
  );
}

const background = await readFile(resolve(root, "background.js"), "utf8");
assert.equal(background.includes("chrome.action.onClicked.addListener"), true);
assert.equal(background.includes("updateSessionRules"), true);

console.log(`Skellock ${manifest.version}: manifest and package inputs are valid.`);
