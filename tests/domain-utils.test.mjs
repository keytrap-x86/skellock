import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../domain-utils.js", import.meta.url),
  "utf8"
);
const context = vm.createContext({ URL });
context.globalThis = context;
vm.runInContext(source, context);
const domains = context.SiteLockDomains;

test("normalizes domains, subdomains, full URLs, ports and IDNs", () => {
  assert.deepEqual(
    { ...domains.parseUserInput("Example.COM") },
    { host: "example.com", includeSubdomains: false }
  );
  assert.deepEqual(
    { ...domains.parseUserInput("https://App.Example.com:8443/team?q=1#today") },
    { host: "app.example.com", includeSubdomains: false }
  );
  assert.deepEqual(
    { ...domains.parseUserInput("*.example.com/path") },
    { host: "example.com", includeSubdomains: true }
  );
  assert.deepEqual(
    { ...domains.parseUserInput("https://*.example.com/path") },
    { host: "example.com", includeSubdomains: true }
  );
  assert.deepEqual(
    { ...domains.parseUserInput("localhost:3000/app") },
    { host: "localhost", includeSubdomains: false }
  );
  assert.equal(
    domains.parseUserInput("https://café.fr/").host,
    "xn--caf-dma.fr"
  );
});

test("rejects unsupported, deceptive and malformed inputs", () => {
  const cases = [
    ["ftp://example.com", "unsupported_scheme"],
    ["https://example.com@evil.test/", "credentials_not_allowed"],
    ["example.*.com", "wildcard_position"],
    ["**mail.google.com", "wildcard_position"],
    ["*", "wildcard_position"],
    ["*.localhost", "invalid_wildcard"],
    ["*.127.0.0.1", "invalid_wildcard"],
    ["not a host", "invalid_site"],
  ];

  for (const [input, reason] of cases) {
    assert.throws(
      () => domains.parseUserInput(input),
      (error) => error.code === reason,
      input
    );
  }
});

test("exact and wildcard matching use hostname label boundaries", () => {
  const exact = {
    id: "exact",
    host: "example.com",
    includeSubdomains: false,
  };
  const wildcard = {
    id: "wildcard",
    host: "example.com",
    includeSubdomains: true,
  };

  assert.equal(domains.entryMatchesHostname(exact, "example.com"), true);
  assert.equal(domains.entryMatchesHostname(exact, "app.example.com"), false);
  assert.equal(domains.entryMatchesHostname(wildcard, "example.com"), true);
  assert.equal(
    domains.entryMatchesHostname(wildcard, "deep.app.example.com"),
    true
  );
  assert.equal(
    domains.entryMatchesHostname(wildcard, "evil-example.com"),
    false
  );
  assert.equal(
    domains.entryMatchesHostname(wildcard, "example.com.evil.test"),
    false
  );
});

test("the most specific matching entry wins", () => {
  const entries = [
    { id: "root", host: "example.com", includeSubdomains: true },
    { id: "admin", host: "admin.example.com", includeSubdomains: false },
    { id: "deep", host: "deep.example.com", includeSubdomains: true },
  ];
  assert.equal(
    domains.findBestMatch(entries, "admin.example.com").id,
    "admin"
  );
  assert.equal(
    domains.findBestMatch(entries, "a.deep.example.com").id,
    "deep"
  );
});

test("generated DNR regexes match only the configured host scope", () => {
  const exact = {
    host: "example.com",
    includeSubdomains: false,
  };
  const wildcard = {
    host: "example.com",
    includeSubdomains: true,
  };
  const exactRegex = new RegExp(domains.urlRegex(exact), "i");
  const wildcardRegex = new RegExp(domains.urlRegex(wildcard), "i");

  assert.equal(exactRegex.test("https://example.com/private?q=1"), true);
  assert.equal(exactRegex.test("http://example.com:8080/"), true);
  assert.equal(exactRegex.test("https://app.example.com/"), false);
  assert.equal(wildcardRegex.test("https://example.com/"), true);
  assert.equal(wildcardRegex.test("https://a.b.example.com/"), true);
  assert.equal(wildcardRegex.test("https://example.com.evil.test/"), false);
  assert.equal(wildcardRegex.test("https://evil-example.com/"), false);
});

test("rule priorities preserve exact and nested overrides", () => {
  const broad = {
    host: "example.com",
    includeSubdomains: true,
  };
  const exactRoot = {
    host: "example.com",
    includeSubdomains: false,
  };
  const nested = {
    host: "admin.example.com",
    includeSubdomains: true,
  };
  const exactNested = {
    host: "admin.example.com",
    includeSubdomains: false,
  };

  assert.ok(domains.rulePriority(exactRoot) > domains.rulePriority(broad));
  assert.ok(domains.rulePriority(nested) > domains.rulePriority(exactRoot));
  assert.ok(
    domains.rulePriority(exactNested) > domains.rulePriority(nested)
  );
});
