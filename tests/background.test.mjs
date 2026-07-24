import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sources = Object.fromEntries(
  await Promise.all(
    ["domain-utils.js", "auth.js", "background.js"].map(async (file) => [
      file,
      await readFile(new URL(`../${file}`, import.meta.url), "utf8"),
    ])
  )
);

const MASTER_PASSWORD = "Master-Test-2026";
const NEXT_MASTER_PASSWORD = "Master-Suivant-2026";
const authContext = vm.createContext({
  crypto: webcrypto,
  TextEncoder,
  Uint8Array,
  TypeError,
  Object,
  Number,
  String,
  btoa,
  atob,
});
authContext.globalThis = authContext;
vm.runInContext(sources["auth.js"], authContext, {
  filename: "auth.js",
});
const MASTER_VERIFIER = structuredClone(
  await authContext.SiteLockAuth.createVerifier(
    MASTER_PASSWORD,
    100_000
  )
);

function clone(value) {
  return value === undefined
    ? undefined
    : structuredClone(value);
}

function createStorageArea(initial = {}, notify = () => undefined) {
  const data = new Map(
    Object.entries(initial).map(([key, value]) => [key, clone(value)])
  );

  return {
    data,
    async get(keys = null) {
      if (keys === null) {
        return Object.fromEntries(
          [...data].map(([key, value]) => [key, clone(value)])
        );
      }
      const requested = Array.isArray(keys)
        ? keys
        : typeof keys === "string"
          ? [keys]
          : Object.keys(keys);
      return Object.fromEntries(
        requested
          .filter((key) => data.has(key))
          .map((key) => [key, clone(data.get(key))])
      );
    },
    async set(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        changes[key] = {
          oldValue: clone(data.get(key)),
          newValue: clone(value),
        };
        data.set(key, clone(value));
      }
      notify(changes);
    },
    async remove(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      const changes = {};
      for (const key of requested) {
        if (data.has(key)) {
          changes[key] = { oldValue: clone(data.get(key)) };
          data.delete(key);
        }
      }
      if (Object.keys(changes).length > 0) {
        notify(changes);
      }
    },
    async setAccessLevel() {},
  };
}

function entry({
  id,
  host,
  includeSubdomains = false,
  auth = { kind: "clock" },
  createdAt = 1,
}) {
  return {
    schema: 1,
    id,
    host,
    includeSubdomains,
    auth,
    createdAt,
    updatedAt: createdAt,
  };
}

function createHarness({
  entries = [],
  masterVerifier = null,
  masterUnlocked = false,
  permissionOrigins = [],
  localData,
  sessionData,
  syncData,
  now = 1_000_000,
} = {}) {
  const listeners = new Map();
  const dynamicRules = new Map();
  const sessionRules = new Map();
  const reloadedTabs = [];
  const updatedTabs = [];
  const createdTabs = [];
  const knownTabs = new Map([
    [37, { id: 37, url: "https://example.com/private" }],
  ]);
  const permissions = new Set(permissionOrigins);

  function event(name) {
    return {
      addListener(listener) {
        const registered = listeners.get(name) ?? [];
        registered.push(listener);
        listeners.set(name, registered);
      },
    };
  }

  function emit(name, ...args) {
    if (name === "tabUpdated" && Number.isInteger(args[0]) && args[2]) {
      knownTabs.set(args[0], clone(args[2]));
    }
    for (const listener of listeners.get(name) ?? []) {
      listener(...args);
    }
  }

  const initialSync = {
    ...(syncData ? Object.fromEntries(syncData) : {}),
    ...Object.fromEntries(
      entries.map((value) => [`sitelock.site.${value.id}`, value])
    ),
    ...(masterVerifier
      ? { "sitelock.masterVerifier": clone(masterVerifier) }
      : {}),
  };
  const sync = createStorageArea(initialSync, (changes) =>
    emit("storageChanged", changes, "sync")
  );
  const local = createStorageArea(
    localData ? Object.fromEntries(localData) : {},
    (changes) =>
    emit("storageChanged", changes, "local")
  );
  const initialSession = {
    ...(sessionData ? Object.fromEntries(sessionData) : {}),
    ...(masterVerifier && masterUnlocked
      ? {
          "sitelock.masterUnlocked": {
            verifierDigest: masterVerifier.digest,
            tabId: 41,
          },
        }
      : {}),
  };
  const session = createStorageArea(
    initialSession,
    (changes) => emit("storageChanged", changes, "session")
  );

  const chrome = {
    runtime: {
      id: "extension-id",
      getURL: (path) => `chrome-extension://extension-id/${path}`,
      getManifest: () => ({ version: "2.0.0" }),
      onMessage: event("message"),
      onStartup: event("startup"),
      onInstalled: event("installed"),
      async openOptionsPage() {},
    },
    storage: {
      sync,
      local,
      session,
      onChanged: event("storageChanged"),
    },
    permissions: {
      async contains({ origins }) {
        return origins.every((origin) => permissions.has(origin));
      },
      async getAll() {
        return {
          origins: [...permissions],
          permissions: [
            "storage",
            "declarativeNetRequestWithHostAccess",
          ],
        };
      },
      async remove({ origins }) {
        let removed = false;
        for (const origin of origins) {
          removed = permissions.delete(origin) || removed;
        }
        if (removed) {
          emit("permissionRemoved", { origins });
        }
        return removed;
      },
      onAdded: event("permissionAdded"),
      onRemoved: event("permissionRemoved"),
    },
    tabs: {
      onRemoved: event("tabRemoved"),
      onUpdated: event("tabUpdated"),
      async query() {
        return [{ id: 37, url: "https://example.com/private" }];
      },
      async reload(tabId) {
        reloadedTabs.push(tabId);
      },
      async get(tabId) {
        const tab = knownTabs.get(tabId);
        if (!tab) {
          throw new Error("tab_not_found");
        }
        return clone(tab);
      },
      async update(tabId, options) {
        const current = knownTabs.get(tabId) ?? { id: tabId };
        const updated = { ...current, ...clone(options) };
        knownTabs.set(tabId, updated);
        updatedTabs.push({ tabId, ...clone(options) });
        return clone(updated);
      },
      async create(options) {
        createdTabs.push(options);
        return { id: 88, ...options };
      },
    },
    windows: {
      onRemoved: event("windowRemoved"),
      async getAll() {
        return [];
      },
    },
    declarativeNetRequest: {
      async getDynamicRules() {
        return [...dynamicRules.values()].map(clone);
      },
      async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
        removeRuleIds.forEach((id) => dynamicRules.delete(id));
        addRules.forEach((rule) => dynamicRules.set(rule.id, clone(rule)));
      },
      async getSessionRules() {
        return [...sessionRules.values()].map(clone);
      },
      async updateSessionRules({ removeRuleIds = [], addRules = [] }) {
        removeRuleIds.forEach((id) => sessionRules.delete(id));
        addRules.forEach((rule) => sessionRules.set(rule.id, clone(rule)));
      },
    },
  };

  class FixedDate extends Date {
    static now() {
      return now;
    }

    toLocaleTimeString() {
      return "09:42";
    }
  }

  const context = vm.createContext({
    URL,
    chrome,
    console,
    crypto: webcrypto,
    TextEncoder,
    Uint8Array,
    TypeError,
    Object,
    Number,
    String,
    RegExp,
    Map,
    Set,
    Promise,
    Date: FixedDate,
    btoa,
    atob,
    structuredClone,
  });
  context.globalThis = context;
  context.importScripts = (...files) => {
    for (const file of files) {
      vm.runInContext(sources[file], context, { filename: file });
    }
  };
  vm.runInContext(sources["background.js"], context, {
    filename: "background.js",
  });

  const lockSender = {
    id: "extension-id",
    url: "chrome-extension://extension-id/lock.html#https://example.com/private",
    frameId: 0,
    tab: { id: 37 },
  };
  const optionsSender = {
    id: "extension-id",
    url: "chrome-extension://extension-id/options.html",
    frameId: 0,
    tab: { id: 41 },
  };
  const secondOptionsSender = {
    ...optionsSender,
    tab: { id: 42 },
  };
  const popupSender = {
    id: "extension-id",
    url: "chrome-extension://extension-id/popup.html",
    frameId: 0,
    tab: { id: 41 },
  };

  async function send(message, sender = lockSender) {
    const messageListeners = listeners.get("message") ?? [];
    assert.equal(messageListeners.length, 1);
    return new Promise((resolve, reject) => {
      const keptOpen = messageListeners[0](message, sender, resolve);
      if (!keptOpen) {
        reject(new Error("message channel was not kept open"));
      }
    });
  }

  async function settle() {
    for (let index = 0; index < 8; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return {
    chrome,
    context,
    createdTabs,
    dynamicRules,
    emit,
    lockSender,
    localData: local.data,
    knownTabs,
    optionsSender,
    permissions,
    popupSender,
    reloadedTabs,
    send,
    sessionData: session.data,
    sessionRules,
    secondOptionsSender,
    settle,
    syncData: sync.data,
    updatedTabs,
  };
}

test("master setup gates settings and stores only a salted verifier", async () => {
  const harness = createHarness();
  await harness.settle();

  const initialStatus = await harness.send(
    { type: "settings.masterStatus" },
    harness.optionsSender
  );
  assert.deepEqual(clone(initialStatus), {
    ok: true,
    configured: false,
    unlocked: false,
  });

  const gated = await harness.send(
    { type: "settings.list" },
    harness.optionsSender
  );
  assert.equal(gated.reason, "master_required");

  const missingUnlock = await harness.send(
    {
      type: "settings.masterUnlock",
      password: MASTER_PASSWORD,
    },
    harness.optionsSender
  );
  assert.equal(missingUnlock.reason, "master_not_configured");

  const invalid = await harness.send(
    { type: "settings.masterCreate", password: null },
    harness.optionsSender
  );
  assert.equal(invalid.reason, "invalid_password");

  const weak = await harness.send(
    { type: "settings.masterCreate", password: "court" },
    harness.optionsSender
  );
  assert.equal(weak.reason, "password_too_short");
  assert.equal(harness.syncData.has("sitelock.masterVerifier"), false);

  const created = await harness.send(
    {
      type: "settings.masterCreate",
      password: MASTER_PASSWORD,
    },
    harness.optionsSender
  );
  assert.deepEqual(clone(created), {
    ok: true,
    configured: true,
    unlocked: true,
  });
  await harness.settle();

  const stored = harness.syncData.get("sitelock.masterVerifier");
  assert.equal(stored.kind, "pbkdf2-sha256");
  assert.equal(stored.iterations, 600_000);
  assert.deepEqual(
    harness.sessionData.get("sitelock.masterUnlocked"),
    {
      verifierDigest: stored.digest,
      tabId: harness.optionsSender.tab.id,
    }
  );
  assert.equal(
    JSON.stringify([...harness.syncData]).includes(MASTER_PASSWORD),
    false
  );
  assert.equal(
    JSON.stringify([...harness.sessionData]).includes(MASTER_PASSWORD),
    false
  );

  const settings = await harness.send(
    { type: "settings.list" },
    harness.optionsSender
  );
  assert.equal(settings.ok, true);

  const duplicate = await harness.send(
    {
      type: "settings.masterCreate",
      password: "Un-autre-secret",
    },
    harness.optionsSender
  );
  assert.equal(duplicate.reason, "master_already_configured");

  const untrusted = await harness.send(
    { type: "settings.masterStatus" },
    harness.popupSender
  );
  assert.equal(untrusted.reason, "unauthorized_sender");
});

test("master lock and unlock protect settings without blocking site controls", async () => {
  const harness = createHarness({
    entries: [entry({ id: "site", host: "example.com" })],
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: true,
    permissionOrigins: ["*://example.com/*"],
  });
  await harness.settle();

  const locked = await harness.send(
    { type: "settings.masterLock" },
    harness.optionsSender
  );
  assert.deepEqual(clone(locked), {
    ok: true,
    configured: true,
    unlocked: false,
  });
  assert.equal(
    (
      await harness.send(
        { type: "settings.list" },
        harness.optionsSender
      )
    ).reason,
    "master_required"
  );
  assert.equal(
    (
      await harness.send(
        { type: "settings.unknown" },
        harness.optionsSender
      )
    ).reason,
    "master_required"
  );

  const popup = await harness.send(
    { type: "popup.status" },
    harness.popupSender
  );
  assert.equal(popup.ok, true);
  const lockContext = await harness.send({
    type: "lock.getContext",
    target: "https://example.com/private",
  });
  assert.equal(lockContext.ok, true);

  const rejected = await harness.send(
    {
      type: "settings.masterUnlock",
      password: "mauvais-secret",
    },
    harness.optionsSender
  );
  assert.equal(rejected.reason, "invalid_master_password");
  assert.equal(rejected.remainingAttempts, 4);

  const unlocked = await harness.send(
    {
      type: "settings.masterUnlock",
      password: MASTER_PASSWORD,
    },
    harness.optionsSender
  );
  assert.deepEqual(clone(unlocked), {
    ok: true,
    configured: true,
    unlocked: true,
  });
  assert.equal(
    (
      await harness.send(
        { type: "settings.list" },
        harness.optionsSender
      )
    ).ok,
    true
  );
});

test("master access is bound to one options tab and survives only its reload", async () => {
  const harness = createHarness({
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: true,
  });
  await harness.settle();

  const primaryStatus = await harness.send(
    { type: "settings.masterStatus" },
    harness.optionsSender
  );
  assert.equal(primaryStatus.unlocked, true);
  assert.equal(
    (
      await harness.send(
        { type: "settings.list" },
        harness.optionsSender
      )
    ).ok,
    true
  );

  const reloadedSender = {
    ...harness.optionsSender,
    url: "chrome-extension://extension-id/options.html?reloaded=1",
  };
  const reloadedStatus = await harness.send(
    { type: "settings.masterStatus" },
    reloadedSender
  );
  assert.equal(reloadedStatus.unlocked, true);

  const secondStatus = await harness.send(
    { type: "settings.masterStatus" },
    harness.secondOptionsSender
  );
  assert.deepEqual(clone(secondStatus), {
    ok: true,
    configured: true,
    unlocked: false,
  });
  const secondList = await harness.send(
    { type: "settings.list" },
    harness.secondOptionsSender
  );
  assert.equal(secondList.reason, "master_required");

  const secondUnlock = await harness.send(
    {
      type: "settings.masterUnlock",
      password: MASTER_PASSWORD,
    },
    harness.secondOptionsSender
  );
  assert.equal(secondUnlock.ok, true);
  assert.equal(
    harness.sessionData.get("sitelock.masterUnlocked").tabId,
    harness.secondOptionsSender.tab.id
  );

  const previousTabAfterTransfer = await harness.send(
    { type: "settings.masterStatus" },
    harness.optionsSender
  );
  assert.equal(previousTabAfterTransfer.unlocked, false);

  harness.emit("tabRemoved", harness.secondOptionsSender.tab.id);
  await harness.settle();
  assert.equal(harness.sessionData.has("sitelock.masterUnlocked"), false);
});

test("changing the master requires the current password and rotates the verifier", async () => {
  const harness = createHarness({
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: false,
  });
  await harness.settle();

  const wrong = await harness.send(
    {
      type: "settings.masterChange",
      currentPassword: "mauvais-secret",
      newPassword: NEXT_MASTER_PASSWORD,
    },
    harness.optionsSender
  );
  assert.equal(wrong.reason, "invalid_master_password");

  const weak = await harness.send(
    {
      type: "settings.masterChange",
      currentPassword: MASTER_PASSWORD,
      newPassword: "court",
    },
    harness.optionsSender
  );
  assert.equal(weak.reason, "password_too_short");
  assert.equal(
    harness.syncData.get("sitelock.masterVerifier").digest,
    MASTER_VERIFIER.digest
  );

  const changed = await harness.send(
    {
      type: "settings.masterChange",
      currentPassword: MASTER_PASSWORD,
      newPassword: NEXT_MASTER_PASSWORD,
    },
    harness.optionsSender
  );
  assert.deepEqual(clone(changed), {
    ok: true,
    configured: true,
    unlocked: true,
  });
  await harness.settle();
  assert.notEqual(
    harness.syncData.get("sitelock.masterVerifier").digest,
    MASTER_VERIFIER.digest
  );
  assert.equal(
    JSON.stringify([...harness.syncData]).includes(NEXT_MASTER_PASSWORD),
    false
  );

  await harness.send(
    { type: "settings.masterLock" },
    harness.optionsSender
  );
  const oldPassword = await harness.send(
    {
      type: "settings.masterUnlock",
      password: MASTER_PASSWORD,
    },
    harness.optionsSender
  );
  assert.equal(oldPassword.reason, "invalid_master_password");

  const newPassword = await harness.send(
    {
      type: "settings.masterUnlock",
      password: NEXT_MASTER_PASSWORD,
    },
    harness.optionsSender
  );
  assert.equal(newPassword.ok, true);
});

test("master-password throttling survives a service-worker restart", async () => {
  const first = createHarness({
    masterVerifier: MASTER_VERIFIER,
  });
  await first.settle();

  for (let index = 0; index < 4; index += 1) {
    const response = await first.send(
      {
        type: "settings.masterUnlock",
        password: "mauvais-secret",
      },
      first.optionsSender
    );
    assert.equal(response.reason, "invalid_master_password");
  }

  const second = createHarness({
    masterVerifier: MASTER_VERIFIER,
    sessionData: first.sessionData,
  });
  await second.settle();
  const fifth = await second.send(
    {
      type: "settings.masterUnlock",
      password: "mauvais-secret",
    },
    second.optionsSender
  );
  assert.equal(fifth.reason, "rate_limited");
  assert.equal(fifth.retryAfterSeconds, 30);

  const blockedCorrect = await second.send(
    {
      type: "settings.masterUnlock",
      password: MASTER_PASSWORD,
    },
    second.optionsSender
  );
  assert.equal(blockedCorrect.reason, "rate_limited");
});

test("a synced master change or removal invalidates the local options session", async () => {
  const harness = createHarness({
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: true,
  });
  await harness.settle();
  await harness.chrome.storage.session.set({
    "sitelock.masterAttempts": {
      verifierDigest: MASTER_VERIFIER.digest,
      failedAttempts: 2,
      blockedUntil: 0,
    },
  });

  const remoteVerifier = structuredClone(
    await authContext.SiteLockAuth.createVerifier(
      NEXT_MASTER_PASSWORD,
      100_000
    )
  );
  await harness.chrome.storage.sync.set({
    "sitelock.masterVerifier": remoteVerifier,
  });
  await harness.settle();
  assert.equal(harness.sessionData.has("sitelock.masterUnlocked"), false);
  assert.equal(harness.sessionData.has("sitelock.masterAttempts"), false);
  const changedStatus = await harness.send(
    { type: "settings.masterStatus" },
    harness.optionsSender
  );
  assert.deepEqual(
    clone(changedStatus),
    { ok: true, configured: true, unlocked: false }
  );

  await harness.chrome.storage.session.set({
    "sitelock.masterUnlocked": {
      verifierDigest: remoteVerifier.digest,
      tabId: harness.optionsSender.tab.id,
    },
  });
  await harness.chrome.storage.sync.remove("sitelock.masterVerifier");
  await harness.settle();
  assert.equal(harness.sessionData.has("sitelock.masterUnlocked"), false);
  const removedStatus = await harness.send(
    { type: "settings.masterStatus" },
    harness.optionsSender
  );
  assert.deepEqual(
    clone(removedStatus),
    { ok: true, configured: false, unlocked: false }
  );
});

test("clock and reverse-clock codes unlock only their matching site", async () => {
  const harness = createHarness({
    entries: [
      entry({ id: "clock", host: "example.com" }),
      entry({
        id: "reverse",
        host: "reverse.test",
        auth: { kind: "reverse-clock" },
      }),
    ],
    permissionOrigins: [
      "*://example.com/*",
      "*://reverse.test/*",
    ],
  });
  await harness.settle();

  const wrong = await harness.send({
    type: "lock.unlock",
    credential: "0000",
    target: "https://example.com/private",
  });
  assert.equal(wrong.reason, "invalid_code");

  const clock = await harness.send({
    type: "lock.unlock",
    credential: "0942",
    target: "https://example.com/private",
  });
  assert.equal(clock.ok, true);
  assert.equal(clock.destination, "https://example.com/private");

  const reverseSender = {
    ...harness.lockSender,
    url: "chrome-extension://extension-id/lock.html#https://reverse.test/",
  };
  const reverse = await harness.send(
    {
      type: "lock.unlock",
      credential: "4209",
      target: "https://reverse.test/",
    },
    reverseSender
  );
  assert.equal(reverse.ok, true);
  assert.equal(harness.sessionRules.size, 2);

  const history = harness.localData.get("sitelock.activityHistory");
  assert.deepEqual(
    history.map((item) => [item.outcome, item.passwordType]),
    [
      ["success", "reverse-clock"],
      ["success", "clock"],
      ["failure", "clock"],
    ]
  );
});

test("custom passwords unlock through the worker and log their type", async () => {
  const harness = createHarness({
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: true,
    permissionOrigins: ["*://example.com/*"],
  });
  await harness.settle();

  const saved = await harness.send(
    {
      type: "settings.save",
      rawSite: "https://example.com/a/full/path?ignored=1",
      includeSubdomains: false,
      passwordType: "custom",
      password: "SiteLock-Test-2026",
    },
    harness.optionsSender
  );
  assert.equal(saved.ok, true);
  assert.equal(saved.entry.host, "example.com");
  assert.equal(saved.entry.passwordType, "custom");

  const storedEntry = [...harness.syncData.values()].find(
    (value) => value?.host === "example.com"
  );
  assert.equal(storedEntry.auth.kind, "pbkdf2-sha256");
  assert.equal(JSON.stringify(storedEntry).includes("SiteLock-Test-2026"), false);

  const rejected = await harness.send({
    type: "lock.unlock",
    credential: "not-the-password",
    target: "https://example.com/private?kept=1",
  });
  assert.equal(rejected.reason, "invalid_code");

  const unlocked = await harness.send({
    type: "lock.unlock",
    credential: "SiteLock-Test-2026",
    target: "https://example.com/private?kept=1",
  });
  assert.equal(unlocked.ok, true);
  assert.equal(
    unlocked.destination,
    "https://example.com/private?kept=1"
  );

  assert.deepEqual(
    harness.localData
      .get("sitelock.activityHistory")
      .map((item) => [item.outcome, item.passwordType]),
    [
      ["success", "custom"],
      ["failure", "custom"],
    ]
  );
});

test("a trusted lock page cannot unlock an unconfigured or deceptive target", async () => {
  const harness = createHarness({
    entries: [entry({ id: "site", host: "example.com" })],
    permissionOrigins: ["*://example.com/*"],
  });
  await harness.settle();

  for (const target of [
    "https://example.com.evil.test/",
    "https://example.com@evil.test/",
    "javascript:alert(1)",
  ]) {
    const response = await harness.send({
      type: "lock.unlock",
      credential: "0942",
      target,
    });
    assert.equal(response.ok, false);
    assert.equal(response.reason, "missing_context");
  }
  assert.equal(harness.sessionRules.size, 0);
});

test("exact rules outrank wildcard rules and broad unlocks stay below them", async () => {
  const harness = createHarness({
    entries: [
      entry({
        id: "wildcard",
        host: "example.com",
        includeSubdomains: true,
      }),
      entry({
        id: "admin",
        host: "admin.example.com",
        auth: { kind: "reverse-clock" },
        createdAt: 2,
      }),
    ],
    permissionOrigins: [
      "*://*.example.com/*",
      "*://admin.example.com/*",
    ],
  });
  await harness.settle();

  const wildcardRedirect = [...harness.dynamicRules.values()].find((rule) =>
    rule.condition.regexFilter.includes("(?:[^./:]+\\.)*example")
  );
  const exactRedirect = [...harness.dynamicRules.values()].find((rule) =>
    rule.condition.regexFilter.includes("admin\\.example")
  );
  assert.ok(wildcardRedirect);
  assert.ok(exactRedirect);
  assert.ok(exactRedirect.priority > wildcardRedirect.priority);

  const unlocked = await harness.send({
    type: "lock.unlock",
    credential: "0942",
    target: "https://team.example.com/",
  });
  assert.equal(unlocked.ok, true);
  const wildcardAllow = [...harness.sessionRules.values()][0];
  assert.equal(wildcardAllow.priority, wildcardRedirect.priority);
  assert.ok(exactRedirect.priority > wildcardAllow.priority);
});

test("failed-attempt throttling survives a service-worker restart", async () => {
  const options = {
    entries: [entry({ id: "site", host: "example.com" })],
    permissionOrigins: ["*://example.com/*"],
  };
  const first = createHarness(options);
  await first.settle();

  for (let index = 0; index < 4; index += 1) {
    const response = await first.send({
      type: "lock.unlock",
      credential: "0000",
      target: "https://example.com/",
    });
    assert.equal(response.reason, "invalid_code");
  }

  const second = createHarness({
    ...options,
    sessionData: first.sessionData,
  });
  await second.settle();
  const fifth = await second.send({
    type: "lock.unlock",
    credential: "0000",
    target: "https://example.com/",
  });
  assert.equal(fifth.reason, "rate_limited");
  assert.equal(fifth.retryAfterSeconds, 30);

  const blockedCorrect = await second.send({
    type: "lock.unlock",
    credential: "0942",
    target: "https://example.com/",
  });
  assert.equal(blockedCorrect.reason, "rate_limited");
});

test("missing host permission keeps a synced site inactive", async () => {
  const harness = createHarness({
    entries: [entry({ id: "site", host: "example.com" })],
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: true,
  });
  await harness.settle();
  assert.equal(harness.dynamicRules.size, 0);

  const settings = await harness.send(
    { type: "settings.list" },
    harness.optionsSender
  );
  assert.equal(settings.ok, true);
  assert.equal(settings.entries[0].permissionState, "missing");
});

test("closing a tab removes every session unlock for that tab", async () => {
  const harness = createHarness({
    entries: [
      entry({ id: "one", host: "example.com" }),
      entry({ id: "two", host: "reverse.test" }),
    ],
    permissionOrigins: [
      "*://example.com/*",
      "*://reverse.test/*",
    ],
  });
  await harness.settle();
  await harness.send({
    type: "lock.unlock",
    credential: "0942",
    target: "https://example.com/",
  });
  await harness.send({
    type: "lock.unlock",
    credential: "0942",
    target: "https://reverse.test/",
  });
  assert.equal(harness.sessionRules.size, 2);

  harness.emit("tabRemoved", 37);
  await harness.settle();
  assert.equal(harness.sessionRules.size, 0);
});

test("staying on the unlocked site keeps the tab unlock", async () => {
  const harness = createHarness({
    entries: [entry({ id: "site", host: "example.com" })],
    permissionOrigins: ["*://example.com/*"],
  });
  await harness.settle();
  await harness.send({
    type: "lock.unlock",
    credential: "0942",
    target: "https://example.com/",
  });
  assert.equal(harness.sessionRules.size, 1);

  harness.emit(
    "tabUpdated",
    37,
    { status: "complete" },
    { id: 37, url: "https://example.com/inbox" }
  );
  await harness.settle();

  assert.equal(harness.sessionRules.size, 1);
  assert.equal(harness.updatedTabs.length, 0);
});

test("a protected URL missed by DNR is locked before it completes", async () => {
  const harness = createHarness({
    entries: [
      entry({
        id: "mail",
        host: "mail.google.com",
        includeSubdomains: true,
      }),
    ],
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: true,
    permissionOrigins: ["*://*.mail.google.com/*"],
  });
  await harness.settle();

  const gmailUrl =
    "https://mail.google.com/mail/u/0/#inbox?credential=do-not-store";
  const gmailTab = { id: 37, url: gmailUrl };
  harness.emit(
    "tabUpdated",
    37,
    { url: gmailUrl, status: "loading" },
    gmailTab
  );
  harness.emit(
    "tabUpdated",
    37,
    { status: "complete" },
    gmailTab
  );
  await harness.settle();

  assert.deepEqual(clone(harness.updatedTabs), [
    {
      tabId: 37,
      url:
        "chrome-extension://extension-id/lock.html#" + gmailUrl,
    },
  ]);

  const diagnostics = await harness.send(
    { type: "settings.getDiagnostics" },
    harness.optionsSender
  );
  const fallbackEvent = diagnostics.diagnostics.events.find(
    (item) => item.event === "tab.fallback.redirected"
  );
  assert.deepEqual(clone(fallbackEvent), {
    timestamp: 1_000_000,
    event: "tab.fallback.redirected",
    tabId: 37,
    sessionRuleCount: 0,
    result: "redirected",
    hostname: "mail.google.com",
    pattern: "*.mail.google.com",
  });
  const serialized = JSON.stringify(diagnostics.diagnostics);
  assert.equal(serialized.includes("/mail/u/0/"), false);
  assert.equal(serialized.includes("do-not-store"), false);
});

test("a broad tab unlock cannot bypass a stricter exact rule", async () => {
  const harness = createHarness({
    entries: [
      entry({
        id: "broad",
        host: "example.com",
        includeSubdomains: true,
      }),
      entry({
        id: "exact",
        host: "app.example.com",
        createdAt: 2,
      }),
    ],
    permissionOrigins: [
      "*://*.example.com/*",
      "*://app.example.com/*",
    ],
  });
  await harness.settle();
  await harness.send({
    type: "lock.unlock",
    credential: "0942",
    target: "https://example.com/",
  });
  assert.equal(harness.sessionRules.size, 1);

  harness.emit(
    "tabUpdated",
    37,
    { url: "https://app.example.com/private" },
    { id: 37, url: "https://app.example.com/private" }
  );
  await harness.settle();

  assert.deepEqual(clone(harness.updatedTabs), [
    {
      tabId: 37,
      url:
        "chrome-extension://extension-id/lock.html#" +
        "https://app.example.com/private",
    },
  ]);
});

test("the fallback respects missing host access and stale navigation state", async () => {
  const harness = createHarness({
    entries: [entry({ id: "site", host: "example.com" })],
  });
  await harness.settle();

  harness.emit(
    "tabUpdated",
    37,
    { status: "complete" },
    { id: 37, url: "https://example.com/private" }
  );
  await harness.settle();
  assert.equal(harness.updatedTabs.length, 0);

  harness.permissions.add("*://example.com/*");
  harness.knownTabs.set(37, {
    id: 37,
    url: "https://unprotected.test/",
  });
  harness.emit(
    "tabUpdated",
    37,
    { status: "complete" },
    { id: 37, url: "https://example.com/private" }
  );
  harness.knownTabs.set(37, {
    id: 37,
    url: "https://unprotected.test/",
  });
  await harness.settle();
  assert.equal(harness.updatedTabs.length, 0);
});

test("leaving the unlocked site clears the tab unlock", async () => {
  const harness = createHarness({
    entries: [entry({ id: "site", host: "example.com" })],
    permissionOrigins: ["*://example.com/*"],
  });
  await harness.settle();
  await harness.send({
    type: "lock.unlock",
    credential: "0942",
    target: "https://example.com/",
  });
  assert.equal(harness.sessionRules.size, 1);

  harness.emit(
    "tabUpdated",
    37,
    { status: "complete" },
    { id: 37 }
  );
  await harness.settle();

  assert.equal(harness.sessionRules.size, 0);
});

test("navigating to another visible site clears the previous tab unlock", async () => {
  const harness = createHarness({
    entries: [
      entry({ id: "one", host: "example.com" }),
      entry({ id: "two", host: "reverse.test" }),
    ],
    permissionOrigins: [
      "*://example.com/*",
      "*://reverse.test/*",
    ],
  });
  await harness.settle();
  await harness.send({
    type: "lock.unlock",
    credential: "0942",
    target: "https://example.com/",
  });
  assert.equal(harness.sessionRules.size, 1);

  harness.emit(
    "tabUpdated",
    37,
    { url: "https://reverse.test/" },
    { id: 37, url: "https://reverse.test/" }
  );
  await harness.settle();

  assert.equal(harness.sessionRules.size, 0);
});

test("browser startup clears restored unlocks before protected tabs resume", async () => {
  const harness = createHarness({
    entries: [entry({ id: "site", host: "example.com" })],
    permissionOrigins: ["*://example.com/*"],
  });
  await harness.settle();
  await harness.send({
    type: "lock.unlock",
    credential: "0942",
    target: "https://example.com/",
  });
  assert.equal(harness.sessionRules.size, 1);

  harness.emit("startup");
  await harness.settle();

  assert.equal(harness.sessionRules.size, 0);
  assert.ok(harness.reloadedTabs.includes(37));
  assert.equal(harness.dynamicRules.size, 1);
});

test("closing the final browser window clears every tab unlock", async () => {
  const harness = createHarness({
    entries: [entry({ id: "site", host: "example.com" })],
    permissionOrigins: ["*://example.com/*"],
  });
  await harness.settle();
  await harness.send({
    type: "lock.unlock",
    credential: "0942",
    target: "https://example.com/",
  });
  assert.equal(harness.sessionRules.size, 1);

  harness.emit("windowRemoved", 9);
  await harness.settle();

  assert.equal(harness.sessionRules.size, 0);
});

test("popup lock-all clears session rules and reloads protected tabs", async () => {
  const harness = createHarness({
    entries: [entry({ id: "site", host: "example.com" })],
    permissionOrigins: ["*://example.com/*"],
  });
  await harness.settle();
  await harness.send({
    type: "lock.unlock",
    credential: "0942",
    target: "https://example.com/",
  });
  assert.equal(harness.sessionRules.size, 1);
  harness.dynamicRules.clear();
  assert.equal(harness.dynamicRules.size, 0);

  const response = await harness.send(
    { type: "popup.lockAll" },
    harness.popupSender
  );
  assert.equal(response.ok, true);
  assert.equal(harness.dynamicRules.size, 1);
  assert.equal(harness.sessionRules.size, 0);
  assert.deepEqual(harness.reloadedTabs, [37]);
});

test("settings can clear the local activity history", async () => {
  const harness = createHarness({
    entries: [entry({ id: "site", host: "example.com" })],
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: true,
    permissionOrigins: ["*://example.com/*"],
  });
  await harness.settle();
  await harness.send({
    type: "lock.unlock",
    credential: "0000",
    target: "https://example.com/",
  });
  assert.equal(
    harness.localData.get("sitelock.activityHistory").length,
    1
  );

  const response = await harness.send(
    { type: "settings.clearHistory" },
    harness.optionsSender
  );
  assert.equal(response.ok, true);
  assert.equal(harness.localData.has("sitelock.activityHistory"), false);
});

test("the authenticated master session can add a more-specific rule", async () => {
  const harness = createHarness({
    entries: [
      entry({
        id: "broad",
        host: "example.com",
        includeSubdomains: true,
      }),
    ],
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: true,
    permissionOrigins: ["*://*.example.com/*"],
  });
  await harness.settle();

  const accepted = await harness.send(
    {
      type: "settings.save",
      rawSite: "admin.example.com",
      includeSubdomains: false,
      passwordType: "reverse-clock",
    },
    harness.optionsSender
  );
  assert.equal(accepted.ok, true);
  assert.equal(
    [...harness.syncData.values()].some(
      (value) =>
        value.host === "admin.example.com" &&
        value.auth?.kind === "reverse-clock"
    ),
    true
  );
});

test("only an authenticated master tab can edit or delete a rule", async () => {
  const harness = createHarness({
    entries: [entry({ id: "site", host: "example.com" })],
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: true,
    permissionOrigins: ["*://example.com/*"],
  });
  await harness.settle();

  const lockedEdit = await harness.send(
    {
      type: "settings.save",
      id: "site",
      rawSite: "example.com",
      includeSubdomains: false,
      passwordType: "reverse-clock",
    },
    harness.secondOptionsSender
  );
  assert.equal(lockedEdit.reason, "master_required");
  assert.equal(
    harness.syncData.get("sitelock.site.site").auth.kind,
    "clock"
  );

  const unauthorizedEdit = await harness.send(
    {
      type: "settings.save",
      id: "site",
      rawSite: "example.com",
      includeSubdomains: false,
      passwordType: "reverse-clock",
    },
    harness.popupSender
  );
  assert.equal(unauthorizedEdit.reason, "unauthorized_sender");
  assert.equal(
    harness.syncData.get("sitelock.site.site").auth.kind,
    "clock"
  );

  const edited = await harness.send(
    {
      type: "settings.save",
      id: "site",
      rawSite: "example.com",
      includeSubdomains: false,
      passwordType: "reverse-clock",
    },
    harness.optionsSender
  );
  assert.equal(edited.ok, true);
  assert.equal(
    harness.syncData.get("sitelock.site.site").auth.kind,
    "reverse-clock"
  );

  const unauthorizedDelete = await harness.send(
    {
      type: "settings.delete",
      id: "site",
    },
    harness.popupSender
  );
  assert.equal(unauthorizedDelete.reason, "unauthorized_sender");
  assert.equal(harness.syncData.has("sitelock.site.site"), true);

  const lockedDelete = await harness.send(
    {
      type: "settings.delete",
      id: "site",
    },
    harness.secondOptionsSender
  );
  assert.equal(lockedDelete.reason, "master_required");
  assert.equal(harness.syncData.has("sitelock.site.site"), true);

  const deleted = await harness.send(
    {
      type: "settings.delete",
      id: "site",
    },
    harness.optionsSender
  );
  assert.equal(deleted.ok, true);
  assert.equal(harness.syncData.has("sitelock.site.site"), false);
  assert.equal(harness.permissions.has("*://example.com/*"), false);
});

test("deleting a wildcard revokes it even when an exact child remains", async () => {
  const harness = createHarness({
    entries: [
      entry({
        id: "broad",
        host: "example.com",
        includeSubdomains: true,
      }),
      entry({
        id: "child",
        host: "app.example.com",
        createdAt: 2,
      }),
    ],
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: true,
    permissionOrigins: ["*://*.example.com/*"],
  });
  await harness.settle();

  const response = await harness.send(
    {
      type: "settings.delete",
      id: "broad",
    },
    harness.optionsSender
  );
  assert.equal(response.ok, true);
  assert.equal(harness.permissions.has("*://*.example.com/*"), false);
  assert.equal(harness.syncData.has("sitelock.site.child"), true);

  const settings = await harness.send(
    { type: "settings.list" },
    harness.optionsSender
  );
  assert.equal(settings.entries[0].permissionState, "missing");
});

test("deleting an exact Edge host removes it from effective permissions", async () => {
  const harness = createHarness({
    entries: [
      entry({
        id: "mail",
        host: "mail.google.com",
      }),
      entry({
        id: "skello",
        host: "skello.io",
        includeSubdomains: true,
        createdAt: 2,
      }),
    ],
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: true,
    permissionOrigins: [
      "*://mail.google.com/*",
      "*://*.skello.io/*",
    ],
  });
  await harness.settle();

  const response = await harness.send(
    {
      type: "settings.delete",
      id: "mail",
    },
    harness.optionsSender
  );
  assert.equal(response.ok, true);
  await harness.settle();

  const granted = await harness.chrome.permissions.getAll();
  assert.deepEqual(granted.origins, ["*://*.skello.io/*"]);
  assert.equal(harness.syncData.has("sitelock.site.mail"), false);
  assert.equal(harness.syncData.has("sitelock.site.skello"), true);
});

test("authenticated diagnostics expose sanitized Gmail state and worker events", async () => {
  const harness = createHarness({
    entries: [entry({ id: "mail", host: "mail.google.com" })],
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: true,
    permissionOrigins: ["*://mail.google.com/*"],
  });
  await harness.settle();

  const unlocked = await harness.send({
    type: "lock.unlock",
    credential: "0942",
    target:
      "https://mail.google.com/mail/u/0/#inbox?credential=do-not-store",
  });
  assert.equal(unlocked.ok, true);
  harness.emit(
    "tabUpdated",
    37,
    { status: "complete" },
    {
      id: 37,
      url:
        "https://mail.google.com/mail/u/0/#inbox?credential=do-not-store",
    }
  );
  await harness.settle();

  const response = await harness.send(
    { type: "settings.getDiagnostics" },
    harness.optionsSender
  );
  assert.equal(response.ok, true);
  assert.equal(response.diagnostics.schema, 1);
  assert.equal(
    response.diagnostics.buildId,
    "relock-fallback-v2"
  );
  assert.equal(response.diagnostics.version, "2.0.0");
  assert.equal(response.diagnostics.generatedAt, 1_000_000);
  assert.ok(
    response.diagnostics.events.some(
      (item) => item.event === "worker.loaded"
    )
  );
  assert.ok(
    response.diagnostics.events.some(
      (item) =>
        item.event === "unlock.allowed" &&
        item.hostname === "mail.google.com" &&
        item.pattern === "mail.google.com" &&
        item.tabId === 37
    )
  );
  assert.ok(
    response.diagnostics.events.some(
      (item) =>
        item.event === "tab.updated.kept" &&
        item.hostname === "mail.google.com"
    )
  );
  assert.deepEqual(
    clone(response.diagnostics.snapshot.entries),
    {
      count: 1,
      activeCount: 1,
      partialCount: 0,
      missingCount: 0,
      sites: [
        {
          hostname: "mail.google.com",
          pattern: "mail.google.com",
          permissionState: "active",
        },
      ],
    }
  );
  assert.equal(response.diagnostics.snapshot.rules.dynamicCount, 1);
  assert.equal(response.diagnostics.snapshot.rules.sessionCount, 1);
  assert.equal(
    response.diagnostics.snapshot.rules.dynamic[0].pattern,
    "mail.google.com"
  );
  assert.deepEqual(
    response.diagnostics.snapshot.rules.session[0].tabIds,
    [37]
  );
  assert.deepEqual(
    clone(response.diagnostics.snapshot.permissions.patterns),
    ["mail.google.com"]
  );

  const serialized = JSON.stringify(response.diagnostics);
  assert.equal(serialized.includes("/mail/u/0/"), false);
  assert.equal(serialized.includes("do-not-store"), false);
  assert.equal(serialized.includes("0942"), false);
  assert.doesNotThrow(() => JSON.parse(serialized));
});

test("diagnostics require the unlocked master tab and can be cleared", async () => {
  const harness = createHarness({
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: true,
  });
  await harness.settle();

  const locked = await harness.send(
    { type: "settings.getDiagnostics" },
    harness.secondOptionsSender
  );
  assert.equal(locked.reason, "master_required");

  const unauthorized = await harness.send(
    { type: "settings.getDiagnostics" },
    harness.popupSender
  );
  assert.equal(unauthorized.reason, "unauthorized_sender");

  assert.ok(
    harness.localData
      .get("sitelock.diagnostics")
      .events.length > 0
  );
  const cleared = await harness.send(
    { type: "settings.clearDiagnostics" },
    harness.optionsSender
  );
  assert.deepEqual(clone(cleared), { ok: true });
  assert.equal(harness.localData.has("sitelock.diagnostics"), false);
});

test("the local diagnostic journal is circular and sanitizes old records", async () => {
  const previousEvents = Array.from({ length: 225 }, (_, index) => ({
    timestamp: index,
    event: "test.previous",
    hostname: "example.com",
    url: `https://example.com/private/${index}`,
    credential: `secret-${index}`,
  }));
  const harness = createHarness({
    masterVerifier: MASTER_VERIFIER,
    masterUnlocked: true,
    localData: new Map([
      [
        "sitelock.diagnostics",
        {
          schema: 1,
          buildId: "old-build",
          events: previousEvents,
        },
      ],
    ]),
  });
  await harness.settle();

  const response = await harness.send(
    { type: "settings.getDiagnostics" },
    harness.optionsSender
  );
  assert.equal(response.ok, true);
  assert.equal(response.diagnostics.events.length, 200);
  assert.equal(
    response.diagnostics.events.at(-1).event,
    "rules.dynamic.rebuilt"
  );
  assert.equal(response.diagnostics.events[0].timestamp, 27);
  const serialized = JSON.stringify(response.diagnostics.events);
  assert.equal(serialized.includes("private"), false);
  assert.equal(serialized.includes("secret-"), false);
});

test("the v1 update migrates Skello idempotently and opens migration settings", async () => {
  const harness = createHarness({
    permissionOrigins: ["https://*.skello.io/*"],
  });
  harness.emit("installed", {
    reason: "update",
    previousVersion: "1.1.0",
  });
  await harness.settle();

  const migrated = harness.syncData.get(
    "sitelock.site.legacy-skello-io"
  );
  assert.equal(migrated.host, "skello.io");
  assert.equal(migrated.includeSubdomains, true);
  assert.equal(migrated.auth.kind, "clock");
  assert.equal(harness.createdTabs.length, 1);
  assert.equal(
    harness.createdTabs[0].url,
    "chrome-extension://extension-id/options.html?migrated=1"
  );

  harness.emit("installed", {
    reason: "update",
    previousVersion: "1.1.0",
  });
  await harness.settle();
  assert.equal(
    [...harness.syncData.keys()].filter((key) =>
      key.startsWith("sitelock.site.")
    ).length,
    1
  );
  assert.equal(harness.createdTabs.length, 1);
});

test("a fresh v2 install opens settings without adding Skello", async () => {
  const harness = createHarness();
  harness.emit("installed", { reason: "install" });
  await harness.settle();
  assert.equal(
    [...harness.syncData.keys()].some((key) =>
      key.startsWith("sitelock.site.")
    ),
    false
  );
  assert.equal(
    harness.createdTabs[0].url,
    "chrome-extension://extension-id/options.html?welcome=1"
  );
});
