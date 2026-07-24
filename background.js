importScripts("domain-utils.js", "auth.js");

const {
  findBestMatch,
  formatPattern,
  normalizeHostname,
  permissionOrigin,
  permissionOriginForScheme,
  rulePriority,
  urlRegex,
} = SiteLockDomains;
const {
  createVerifier,
  isValidVerifier,
  verifyPassword,
} = SiteLockAuth;

const LOCK_PAGE_URL = chrome.runtime.getURL("lock.html");
const OPTIONS_PAGE_URL = chrome.runtime.getURL("options.html");
const POPUP_PAGE_URL = chrome.runtime.getURL("popup.html");
const SITE_KEY_PREFIX = "sitelock.site.";
const ATTEMPT_KEY_PREFIX = "sitelock.attempt.";
const META_KEY = "sitelock.meta";
const HISTORY_KEY = "sitelock.activityHistory";
const MASTER_VERIFIER_KEY = "sitelock.masterVerifier";
const MASTER_UNLOCKED_KEY = "sitelock.masterUnlocked";
const MASTER_ATTEMPT_KEY = "sitelock.masterAttempts";
const DIAGNOSTIC_KEY = "sitelock.diagnostics";
const DIAGNOSTIC_BUILD_ID = "relock-fallback-v2";
const LEGACY_ENTRY_ID = "legacy-skello-io";
const ENTRY_SCHEMA = 1;
const SETTINGS_SCHEMA = 2;
const DIAGNOSTIC_SCHEMA = 1;
const MAX_ENTRIES = 100;
const MAX_HISTORY_ITEMS = 50;
const MAX_DIAGNOSTIC_EVENTS = 200;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30_000;

let ruleQueue = Promise.resolve();
let credentialQueue = Promise.resolve();
let protectionQueue = Promise.resolve();
let diagnosticQueue = Promise.resolve();
let protectionRevision = 0;
let navigationEntriesCache = null;
const tabNavigationRevisions = new Map();
const tabNavigationUrls = new Map();
const fallbackRedirectTargets = new Map();

const DIAGNOSTIC_INTEGER_FIELDS = new Set([
  "tabId",
  "entryCount",
  "activeEntryCount",
  "partialEntryCount",
  "missingEntryCount",
  "previousDynamicRuleCount",
  "dynamicRuleCount",
  "sessionRuleCount",
  "matchedRuleCount",
  "removedRuleCount",
  "reloadedTabCount",
  "permissionOriginCount",
  "permissionNameCount",
  "windowCount",
]);
const DIAGNOSTIC_TEXT_FIELDS = new Set([
  "result",
  "trigger",
  "permissionState",
]);

function extensionVersion() {
  try {
    const version = chrome.runtime.getManifest?.().version;
    return typeof version === "string" && version.length <= 32
      ? version
      : "unknown";
  } catch {
    return "unknown";
  }
}

function sanitizeDiagnosticHostname(value) {
  if (typeof value !== "string" || value.length > 253) {
    return null;
  }
  try {
    return normalizeHostname(value);
  } catch {
    return null;
  }
}

function sanitizeDiagnosticPattern(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) {
    return null;
  }
  const wildcard = value.startsWith("*.");
  const hostname = sanitizeDiagnosticHostname(
    wildcard ? value.slice(2) : value
  );
  return hostname ? `${wildcard ? "*." : ""}${hostname}` : null;
}

function diagnosticHostnameFromUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return sanitizeDiagnosticHostname(url.hostname);
  } catch {
    return null;
  }
}

function diagnosticPatternFromOrigin(value) {
  if (typeof value !== "string" || value.length > 512) {
    return null;
  }
  const match = value.match(
    /^(?:\*|https?|file):\/\/(\*\.)?([^/]+)\/\*$/
  );
  if (!match) {
    return null;
  }
  const hostname = sanitizeDiagnosticHostname(match[2]);
  return hostname ? `${match[1] ? "*." : ""}${hostname}` : null;
}

function sanitizeDiagnosticText(value) {
  return typeof value === "string" &&
    /^[a-z0-9_.:-]{1,64}$/i.test(value)
    ? value
    : null;
}

function sanitizeDiagnosticEvent(value) {
  if (
    !value ||
    !Number.isFinite(value.timestamp) ||
    !sanitizeDiagnosticText(value.event)
  ) {
    return null;
  }

  const sanitized = {
    timestamp: value.timestamp,
    event: value.event,
  };
  for (const field of DIAGNOSTIC_INTEGER_FIELDS) {
    if (
      Number.isInteger(value[field]) &&
      value[field] >= 0 &&
      value[field] <= Number.MAX_SAFE_INTEGER
    ) {
      sanitized[field] = value[field];
    }
  }
  for (const field of DIAGNOSTIC_TEXT_FIELDS) {
    const text = sanitizeDiagnosticText(value[field]);
    if (text) {
      sanitized[field] = text;
    }
  }

  const hostname = sanitizeDiagnosticHostname(value.hostname);
  if (hostname) {
    sanitized.hostname = hostname;
  }
  const pattern = sanitizeDiagnosticPattern(value.pattern);
  if (pattern) {
    sanitized.pattern = pattern;
  }
  return sanitized;
}

async function loadDiagnosticEventsNow() {
  const stored = await chrome.storage.local.get(DIAGNOSTIC_KEY);
  const events = stored[DIAGNOSTIC_KEY]?.events;
  return (Array.isArray(events) ? events : [])
    .map(sanitizeDiagnosticEvent)
    .filter(Boolean)
    .slice(-MAX_DIAGNOSTIC_EVENTS);
}

function recordDiagnostic(event, details = {}) {
  const item = sanitizeDiagnosticEvent({
    timestamp: Date.now(),
    event,
    ...details,
  });
  if (!item) {
    return Promise.resolve();
  }

  const queuedTask = diagnosticQueue
    .catch(() => undefined)
    .then(async () => {
      const events = await loadDiagnosticEventsNow();
      events.push(item);
      await chrome.storage.local.set({
        [DIAGNOSTIC_KEY]: {
          schema: DIAGNOSTIC_SCHEMA,
          buildId: DIAGNOSTIC_BUILD_ID,
          events: events.slice(-MAX_DIAGNOSTIC_EVENTS),
        },
      });
    });
  diagnosticQueue = queuedTask.catch(() => undefined);
  return queuedTask;
}

function clearDiagnosticEvents() {
  const queuedTask = diagnosticQueue
    .catch(() => undefined)
    .then(() => chrome.storage.local.remove(DIAGNOSTIC_KEY));
  diagnosticQueue = queuedTask.catch(() => undefined);
  return queuedTask;
}

function siteStorageKey(id) {
  return `${SITE_KEY_PREFIX}${id}`;
}

function attemptStorageKey(id) {
  return `${ATTEMPT_KEY_PREFIX}${id}`;
}

function safeId(value) {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value);
}

function createId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sanitizeAuth(auth) {
  if (auth?.kind === "clock") {
    return { kind: "clock" };
  }
  if (auth?.kind === "reverse-clock") {
    return { kind: "reverse-clock" };
  }
  if (isValidVerifier(auth)) {
    return {
      kind: "pbkdf2-sha256",
      iterations: auth.iterations,
      salt: auth.salt,
      digest: auth.digest,
    };
  }
  return null;
}

function sanitizeVerifier(value) {
  if (!isValidVerifier(value)) {
    return null;
  }
  return {
    kind: "pbkdf2-sha256",
    iterations: value.iterations,
    salt: value.salt,
    digest: value.digest,
  };
}

function sanitizeEntry(value, key = "") {
  if (
    !value ||
    value.schema !== ENTRY_SCHEMA ||
    !safeId(value.id) ||
    (key && key !== siteStorageKey(value.id)) ||
    typeof value.includeSubdomains !== "boolean"
  ) {
    return null;
  }

  let host;
  try {
    host = normalizeHostname(value.host);
  } catch {
    return null;
  }

  if (
    host !== value.host ||
    (value.includeSubdomains &&
      (SiteLockDomains.isIpAddress(host) ||
        host === "localhost" ||
        !host.includes(".")))
  ) {
    return null;
  }

  const auth = sanitizeAuth(value.auth);
  if (!auth) {
    return null;
  }

  return {
    schema: ENTRY_SCHEMA,
    id: value.id,
    host,
    includeSubdomains: value.includeSubdomains,
    auth,
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : 0,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
  };
}

async function loadEntries() {
  const stored = await chrome.storage.sync.get(null);
  return Object.entries(stored)
    .filter(([key]) => key.startsWith(SITE_KEY_PREFIX))
    .map(([key, value]) => sanitizeEntry(value, key))
    .filter(Boolean)
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id)
    );
}

async function setTrustedStorageAccess() {
  await Promise.allSettled([
    chrome.storage.sync.setAccessLevel?.({
      accessLevel: "TRUSTED_CONTEXTS",
    }),
    chrome.storage.local.setAccessLevel?.({
      accessLevel: "TRUSTED_CONTEXTS",
    }),
    chrome.storage.session.setAccessLevel?.({
      accessLevel: "TRUSTED_CONTEXTS",
    }),
  ]);
}

async function containsOrigin(origin) {
  try {
    return await chrome.permissions.contains({ origins: [origin] });
  } catch {
    return false;
  }
}

async function permissionState(entry) {
  if (await containsOrigin(permissionOrigin(entry))) {
    return "active";
  }

  const [http, https] = await Promise.all([
    containsOrigin(permissionOriginForScheme(entry, "http")),
    containsOrigin(permissionOriginForScheme(entry, "https")),
  ]);
  if (http && https) {
    return "active";
  }
  if (http || https) {
    return "partial";
  }
  return "missing";
}

async function hasPermissionForUrl(entry, url) {
  const scheme = url.protocol.replace(":", "");
  return (
    (await containsOrigin(permissionOrigin(entry))) ||
    (await containsOrigin(permissionOriginForScheme(entry, scheme)))
  );
}

function publicEntry(entry, state) {
  return {
    id: entry.id,
    host: entry.host,
    includeSubdomains: entry.includeSubdomains,
    pattern: formatPattern(entry),
    passwordType:
      entry.auth.kind === "pbkdf2-sha256" ? "custom" : entry.auth.kind,
    permissionState: state,
  };
}

function dynamicRule(entry, id) {
  return {
    id,
    priority: rulePriority(entry),
    action: {
      type: "redirect",
      redirect: {
        regexSubstitution: `${LOCK_PAGE_URL}#\\0`,
      },
    },
    condition: {
      regexFilter: urlRegex(entry),
      isUrlFilterCaseSensitive: false,
      resourceTypes: ["main_frame"],
    },
  };
}

async function rebuildDynamicRulesNow() {
  const entries = await loadEntries();
  navigationEntriesCache = entries;
  const states = await Promise.all(entries.map(permissionState));
  const activeEntries = entries
    .filter((_, index) => states[index] !== "missing")
    .sort(
      (left, right) =>
        rulePriority(right) - rulePriority(left) ||
        left.id.localeCompare(right.id)
    );
  const existingRules =
    await chrome.declarativeNetRequest.getDynamicRules();

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingRules.map((rule) => rule.id),
    addRules: activeEntries.map((entry, index) =>
      dynamicRule(entry, index + 1)
    ),
  });
  await recordDiagnostic("rules.dynamic.rebuilt", {
    result: "ok",
    entryCount: entries.length,
    activeEntryCount: states.filter((state) => state === "active").length,
    partialEntryCount: states.filter((state) => state === "partial").length,
    missingEntryCount: states.filter((state) => state === "missing").length,
    previousDynamicRuleCount: existingRules.length,
    dynamicRuleCount: activeEntries.length,
  }).catch(() => undefined);
}

function rebuildDynamicRules() {
  ruleQueue = ruleQueue
    .catch(() => undefined)
    .then(rebuildDynamicRulesNow);
  return ruleQueue;
}

async function removeAllSessionRules() {
  const sessionRules =
    await chrome.declarativeNetRequest.getSessionRules();
  if (sessionRules.length > 0) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: sessionRules.map((rule) => rule.id),
    });
  }
  await recordDiagnostic("rules.session.cleared", {
    result: "ok",
    removedRuleCount: sessionRules.length,
    sessionRuleCount: 0,
  }).catch(() => undefined);
  return sessionRules.length;
}

async function queryProtectedTabs(entries) {
  const originGroups = await Promise.all(
    entries.map(async (entry) => {
      if (await containsOrigin(permissionOrigin(entry))) {
        return [permissionOrigin(entry)];
      }
      const origins = [];
      for (const scheme of ["http", "https"]) {
        const origin = permissionOriginForScheme(entry, scheme);
        if (await containsOrigin(origin)) {
          origins.push(origin);
        }
      }
      return origins;
    })
  );
  const origins = [...new Set(originGroups.flat())];
  if (origins.length === 0) {
    return [];
  }

  try {
    return await chrome.tabs.query({ url: origins });
  } catch {
    return [];
  }
}

async function lockAllProtectedTabs({ rebuild = true } = {}) {
  if (rebuild) {
    await rebuildDynamicRules();
  }
  await removeAllSessionRules();
  const entries = await loadEntries();
  const tabs = await queryProtectedTabs(entries);
  const uniqueTabIds = [
    ...new Set(
      tabs
        .map((tab) => tab.id)
        .filter((tabId) => Number.isInteger(tabId) && tabId > 0)
    ),
  ];
  await Promise.allSettled(
    uniqueTabIds.map((tabId) => chrome.tabs.reload(tabId))
  );
  return uniqueTabIds.length;
}

function reconcileProtection(trigger = "unspecified") {
  protectionQueue = protectionQueue
    .catch(() => undefined)
    .then(async () => {
      await recordDiagnostic("protection.reconcile.started", {
        trigger,
      }).catch(() => undefined);
      try {
        await rebuildDynamicRules();
        const reloadedTabCount = await lockAllProtectedTabs({
          rebuild: false,
        });
        const [entries, dynamicRules, sessionRules] = await Promise.all([
          loadEntries(),
          chrome.declarativeNetRequest.getDynamicRules(),
          chrome.declarativeNetRequest.getSessionRules(),
        ]);
        await recordDiagnostic("protection.reconcile.completed", {
          trigger,
          result: "ok",
          entryCount: entries.length,
          dynamicRuleCount: dynamicRules.length,
          sessionRuleCount: sessionRules.length,
          reloadedTabCount,
        }).catch(() => undefined);
        return reloadedTabCount;
      } catch (error) {
        await recordDiagnostic("protection.reconcile.failed", {
          trigger,
          result: "error",
        }).catch(() => undefined);
        throw error;
      }
    });
  return protectionQueue;
}

function extensionPageMatches(sender, pageUrl, requireTab = false) {
  const senderUrl = typeof sender.url === "string"
    ? sender.url.split(/[?#]/, 1)[0]
    : "";
  return (
    sender.id === chrome.runtime.id &&
    senderUrl === pageUrl &&
    (sender.frameId === undefined || sender.frameId === 0) &&
    (!requireTab ||
      (Number.isInteger(sender.tab?.id) && sender.tab.id > 0))
  );
}

function trustedLockPage(sender) {
  return extensionPageMatches(sender, LOCK_PAGE_URL, true);
}

function trustedOptionsPage(sender) {
  return extensionPageMatches(sender, OPTIONS_PAGE_URL, true);
}

function trustedPopupPage(sender) {
  return extensionPageMatches(sender, POPUP_PAGE_URL);
}

async function loadMasterVerifier() {
  const stored = await chrome.storage.sync.get(MASTER_VERIFIER_KEY);
  return sanitizeVerifier(stored[MASTER_VERIFIER_KEY]);
}

async function loadMasterAccessState(tabId) {
  const verifier = await loadMasterVerifier();
  if (!verifier) {
    return {
      verifier: null,
      configured: false,
      unlocked: false,
    };
  }

  const stored = await chrome.storage.session.get(MASTER_UNLOCKED_KEY);
  return {
    verifier,
    configured: true,
    unlocked:
      stored[MASTER_UNLOCKED_KEY]?.verifierDigest === verifier.digest &&
      stored[MASTER_UNLOCKED_KEY]?.tabId === tabId,
  };
}

function masterPasswordError(error) {
  return error?.message === "password_too_short"
    ? "password_too_short"
    : "invalid_password";
}

async function validateMasterPassword(verifier, password) {
  const now = Date.now();
  const stored = await chrome.storage.session.get(MASTER_ATTEMPT_KEY);
  const savedState = stored[MASTER_ATTEMPT_KEY];
  const state =
    savedState?.verifierDigest === verifier.digest ? savedState : null;

  if (Number.isFinite(state?.blockedUntil) && state.blockedUntil > now) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: Math.ceil((state.blockedUntil - now) / 1000),
    };
  }

  if (await verifyPassword(password, verifier)) {
    await chrome.storage.session.remove(MASTER_ATTEMPT_KEY);
    return { ok: true };
  }

  const failedAttempts =
    (Number.isInteger(state?.failedAttempts) ? state.failedAttempts : 0) + 1;
  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    const blockedUntil = now + LOCKOUT_DURATION_MS;
    await chrome.storage.session.set({
      [MASTER_ATTEMPT_KEY]: {
        verifierDigest: verifier.digest,
        failedAttempts: 0,
        blockedUntil,
      },
    });
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: Math.ceil(LOCKOUT_DURATION_MS / 1000),
    };
  }

  await chrome.storage.session.set({
    [MASTER_ATTEMPT_KEY]: {
      verifierDigest: verifier.digest,
      failedAttempts,
      blockedUntil: 0,
    },
  });
  return {
    ok: false,
    reason: "invalid_master_password",
    remainingAttempts: MAX_FAILED_ATTEMPTS - failedAttempts,
  };
}

async function masterStatus(sender) {
  if (!trustedOptionsPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }
  const { configured, unlocked } = await loadMasterAccessState(sender.tab.id);
  return { ok: true, configured, unlocked };
}

async function masterCreate(message, sender) {
  if (!trustedOptionsPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }
  if (await loadMasterVerifier()) {
    return { ok: false, reason: "master_already_configured" };
  }

  let verifier;
  try {
    verifier = await createVerifier(message.password);
  } catch (error) {
    return { ok: false, reason: masterPasswordError(error) };
  }

  await chrome.storage.sync.set({ [MASTER_VERIFIER_KEY]: verifier });
  await chrome.storage.session.remove(MASTER_ATTEMPT_KEY);
  await chrome.storage.session.set({
    [MASTER_UNLOCKED_KEY]: {
      verifierDigest: verifier.digest,
      tabId: sender.tab.id,
    },
  });
  return { ok: true, configured: true, unlocked: true };
}

async function masterUnlock(message, sender) {
  if (!trustedOptionsPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }
  const verifier = await loadMasterVerifier();
  if (!verifier) {
    return { ok: false, reason: "master_not_configured" };
  }

  const validation = await validateMasterPassword(verifier, message.password);
  if (!validation.ok) {
    return validation;
  }
  await chrome.storage.session.set({
    [MASTER_UNLOCKED_KEY]: {
      verifierDigest: verifier.digest,
      tabId: sender.tab.id,
    },
  });
  return { ok: true, configured: true, unlocked: true };
}

async function masterLock(sender) {
  if (!trustedOptionsPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }
  if (!(await loadMasterVerifier())) {
    return { ok: false, reason: "master_not_configured" };
  }
  const stored = await chrome.storage.session.get(MASTER_UNLOCKED_KEY);
  if (stored[MASTER_UNLOCKED_KEY]?.tabId === sender.tab.id) {
    await chrome.storage.session.remove(MASTER_UNLOCKED_KEY);
  }
  return { ok: true, configured: true, unlocked: false };
}

async function masterChange(message, sender) {
  if (!trustedOptionsPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }
  const currentVerifier = await loadMasterVerifier();
  if (!currentVerifier) {
    return { ok: false, reason: "master_not_configured" };
  }

  const validation = await validateMasterPassword(
    currentVerifier,
    message.currentPassword
  );
  if (!validation.ok) {
    return validation;
  }

  let nextVerifier;
  try {
    nextVerifier = await createVerifier(message.newPassword);
  } catch (error) {
    return { ok: false, reason: masterPasswordError(error) };
  }

  await chrome.storage.sync.set({
    [MASTER_VERIFIER_KEY]: nextVerifier,
  });
  await chrome.storage.session.remove(MASTER_ATTEMPT_KEY);
  await chrome.storage.session.set({
    [MASTER_UNLOCKED_KEY]: {
      verifierDigest: nextVerifier.digest,
      tabId: sender.tab.id,
    },
  });
  return { ok: true, configured: true, unlocked: true };
}

function resolveTarget(target, entries) {
  if (typeof target !== "string" || target.length === 0 || target.length > 8192) {
    return null;
  }

  let url;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    return null;
  }

  let host;
  try {
    host = normalizeHostname(url.hostname);
  } catch {
    return null;
  }

  const entry = findBestMatch(entries, host);
  return entry ? { entry, url } : null;
}

async function lockContext(message, sender) {
  if (!trustedLockPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }

  const entries = await loadEntries();
  const context = resolveTarget(message.target, entries);
  if (!context) {
    return { ok: false, reason: "missing_context" };
  }
  if (!(await hasPermissionForUrl(context.entry, context.url))) {
    return { ok: false, reason: "permission_missing" };
  }

  return {
    ok: true,
    site: {
      id: context.entry.id,
      hostname: context.url.hostname,
      pattern: formatPattern(context.entry),
    },
  };
}

function expectedAccessCode() {
  return new Date()
    .toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(/:/g, "");
}

function expectedReverseAccessCode() {
  const clockCode = expectedAccessCode();
  return `${clockCode.slice(2)}${clockCode.slice(0, 2)}`;
}

async function validateCredential(entry, credential) {
  const key = attemptStorageKey(entry.id);
  const now = Date.now();
  const stored = await chrome.storage.session.get(key);
  const state = stored[key];

  if (Number.isFinite(state?.blockedUntil) && state.blockedUntil > now) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: Math.ceil((state.blockedUntil - now) / 1000),
    };
  }

  let valid = false;
  if (entry.auth.kind === "clock") {
    valid =
      typeof credential === "string" &&
      /^\d{4}$/.test(credential) &&
      credential === expectedAccessCode();
  } else if (entry.auth.kind === "reverse-clock") {
    valid =
      typeof credential === "string" &&
      /^\d{4}$/.test(credential) &&
      credential === expectedReverseAccessCode();
  } else {
    valid = await verifyPassword(credential, entry.auth);
  }

  if (valid) {
    await chrome.storage.session.remove(key);
    return { ok: true };
  }

  const failedAttempts =
    (Number.isInteger(state?.failedAttempts) ? state.failedAttempts : 0) + 1;
  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    const blockedUntil = now + LOCKOUT_DURATION_MS;
    await chrome.storage.session.set({
      [key]: { failedAttempts: 0, blockedUntil },
    });
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: Math.ceil(LOCKOUT_DURATION_MS / 1000),
    };
  }

  await chrome.storage.session.set({
    [key]: { failedAttempts, blockedUntil: 0 },
  });
  return {
    ok: false,
    reason: "invalid_code",
    remainingAttempts: MAX_FAILED_ATTEMPTS - failedAttempts,
  };
}

function nextSessionRuleId(rules) {
  const used = new Set(rules.map((rule) => rule.id));
  for (let candidate = 1; candidate <= 1000; candidate += 1) {
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  throw new Error("Too many unlocked sites");
}

async function allowEntryInTab(entry, tabId) {
  const regexFilter = urlRegex(entry);
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const existing = rules.find(
    (rule) =>
      rule.condition.regexFilter === regexFilter &&
      rule.condition.tabIds?.includes(tabId)
  );
  const id = existing?.id ?? nextSessionRuleId(rules);

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: existing ? [id] : [],
    addRules: [
      {
        id,
        priority: rulePriority(entry),
        action: { type: "allow" },
        condition: {
          regexFilter,
          isUrlFilterCaseSensitive: false,
          resourceTypes: ["main_frame"],
          tabIds: [tabId],
        },
      },
    ],
  });
  await recordDiagnostic("unlock.allowed", {
    result: existing ? "refreshed" : "created",
    tabId,
    hostname: entry.host,
    pattern: formatPattern(entry),
    sessionRuleCount: existing ? rules.length : rules.length + 1,
  }).catch(() => undefined);
}

function sessionRuleMatchesUrl(rule, url) {
  if (
    typeof url !== "string" ||
    url.length === 0 ||
    typeof rule.condition?.regexFilter !== "string"
  ) {
    return false;
  }

  try {
    const flags = rule.condition.isUrlFilterCaseSensitive ? "" : "i";
    return new RegExp(rule.condition.regexFilter, flags).test(url);
  } catch {
    return false;
  }
}

async function reconcileTabUnlocks(tabId, visibleUrl) {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const tabRules = rules.filter(
    (rule) =>
      rule.action?.type === "allow" &&
      rule.condition?.tabIds?.includes(tabId)
  );
  const hostname = diagnosticHostnameFromUrl(visibleUrl);
  if (tabRules.length === 0) {
    if (hostname) {
      await recordDiagnostic("tab.updated.observed", {
        result: "no_unlock_rule",
        tabId,
        hostname,
        sessionRuleCount: rules.length,
      }).catch(() => undefined);
    }
    return;
  }

  const obsoleteRuleIds = tabRules
    .filter((rule) => !sessionRuleMatchesUrl(rule, visibleUrl))
    .map((rule) => rule.id);

  if (obsoleteRuleIds.length > 0) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: obsoleteRuleIds,
    });
  }
  const matchingRuleCount = tabRules.length - obsoleteRuleIds.length;
  const event =
    visibleUrl.length === 0
      ? "tab.updated.hidden"
      : obsoleteRuleIds.length > 0
        ? "tab.updated.removed"
        : "tab.updated.kept";
  await recordDiagnostic(event, {
    result:
      obsoleteRuleIds.length === 0
        ? "kept"
        : matchingRuleCount > 0
          ? "partially_removed"
          : "removed",
    tabId,
    hostname,
    matchedRuleCount: matchingRuleCount,
    removedRuleCount: obsoleteRuleIds.length,
    sessionRuleCount: rules.length - obsoleteRuleIds.length,
  }).catch(() => undefined);
}

async function currentTabUrl(tabId, observedUrl) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (typeof tab?.pendingUrl === "string" && tab.pendingUrl.length > 0) {
      return tab.pendingUrl;
    }
    if (typeof tab?.url === "string" && tab.url.length > 0) {
      return tab.url;
    }
  } catch {
    // The tab can disappear while its final update is being processed.
  }
  return observedUrl;
}

function registerTabNavigation(tabId, visibleUrl, isUrlChange) {
  const previousUrl = tabNavigationUrls.get(tabId);
  let revision = tabNavigationRevisions.get(tabId) ?? 0;
  if (isUrlChange || previousUrl !== visibleUrl || revision === 0) {
    revision += 1;
    tabNavigationRevisions.set(tabId, revision);
    tabNavigationUrls.set(tabId, visibleUrl);
  }
  return revision;
}

function navigationIsCurrent(tabId, revision, revisionAtStart) {
  return (
    tabNavigationRevisions.get(tabId) === revision &&
    protectionRevision === revisionAtStart
  );
}

async function redirectTabToLock(
  tabId,
  targetUrl,
  entry,
  sessionRuleCount
) {
  if (fallbackRedirectTargets.get(tabId) === targetUrl) {
    return;
  }
  fallbackRedirectTargets.set(tabId, targetUrl);

  try {
    await chrome.tabs.update(tabId, {
      url: `${LOCK_PAGE_URL}#${targetUrl}`,
    });
    await recordDiagnostic("tab.fallback.redirected", {
      result: "redirected",
      tabId,
      hostname: entry.host,
      pattern: formatPattern(entry),
      sessionRuleCount,
    }).catch(() => undefined);
  } catch (error) {
    fallbackRedirectTargets.delete(tabId);
    await recordDiagnostic("tab.fallback.failed", {
      result: "error",
      tabId,
      hostname: entry.host,
      pattern: formatPattern(entry),
      sessionRuleCount,
    }).catch(() => undefined);
    throw error;
  }
}

async function ensureProtectedTabIsLocked(
  tabId,
  observedUrl,
  revision,
  revisionAtStart,
  isEarlyUrlChange
) {
  const [visibleUrl, entries, sessionRules] = await Promise.all([
    currentTabUrl(tabId, observedUrl),
    navigationEntriesCache
      ? Promise.resolve(navigationEntriesCache)
      : loadEntries(),
    chrome.declarativeNetRequest.getSessionRules(),
  ]);
  if (!navigationIsCurrent(tabId, revision, revisionAtStart)) {
    return;
  }
  const context = resolveTarget(visibleUrl, entries);
  if (!context) {
    fallbackRedirectTargets.delete(tabId);
    return;
  }

  const isUnlocked = sessionRules.some(
    (rule) =>
      rule.action?.type === "allow" &&
      rule.condition?.tabIds?.includes(tabId) &&
      rule.condition?.regexFilter === urlRegex(context.entry) &&
      sessionRuleMatchesUrl(rule, visibleUrl)
  );
  if (isUnlocked) {
    fallbackRedirectTargets.delete(tabId);
    return;
  }

  if (isEarlyUrlChange) {
    // Without the broad "tabs" permission, Chrome exposes changeInfo.url only
    // when the already-granted host access covers this navigation. Redirecting
    // here avoids briefly painting a page when Edge skips the DNR redirect.
    if (
      !navigationIsCurrent(tabId, revision, revisionAtStart)
    ) {
      return;
    }
    await redirectTabToLock(
      tabId,
      visibleUrl,
      context.entry,
      sessionRules.length
    );
    return;
  }

  if (!(await hasPermissionForUrl(context.entry, context.url))) {
    fallbackRedirectTargets.delete(tabId);
    return;
  }
  if (!navigationIsCurrent(tabId, revision, revisionAtStart)) {
    return;
  }

  const finalUrl = await currentTabUrl(tabId, observedUrl);
  if (
    !navigationIsCurrent(tabId, revision, revisionAtStart) ||
    finalUrl !== visibleUrl
  ) {
    return;
  }
  const finalContext = resolveTarget(finalUrl, entries);
  if (
    !finalContext ||
    finalContext.entry.id !== context.entry.id
  ) {
    fallbackRedirectTargets.delete(tabId);
    return;
  }

  await redirectTabToLock(
    tabId,
    finalUrl,
    context.entry,
    sessionRules.length
  );
}

function reconcileTabNavigation(
  tabId,
  visibleUrl,
  revision,
  revisionAtStart,
  isEarlyUrlChange
) {
  return Promise.all([
    reconcileTabUnlocks(tabId, visibleUrl),
    ensureProtectedTabIsLocked(
      tabId,
      visibleUrl,
      revision,
      revisionAtStart,
      isEarlyUrlChange
    ),
  ]);
}

function sanitizeHistoryItem(value) {
  if (
    !value ||
    !safeId(value.id) ||
    typeof value.hostname !== "string" ||
    typeof value.pattern !== "string" ||
    !Number.isFinite(value.occurredAt) ||
    !["success", "failure"].includes(value.outcome) ||
    !["clock", "reverse-clock", "custom"].includes(value.passwordType)
  ) {
    return null;
  }

  let hostname;
  try {
    hostname = normalizeHostname(value.hostname);
  } catch {
    return null;
  }
  if (
    hostname !== value.hostname ||
    value.pattern.length === 0 ||
    value.pattern.length > 255
  ) {
    return null;
  }
  return {
    id: value.id,
    hostname,
    pattern: value.pattern,
    outcome: value.outcome,
    passwordType: value.passwordType,
    occurredAt: value.occurredAt,
  };
}

async function loadActivityHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const history = Array.isArray(stored[HISTORY_KEY])
    ? stored[HISTORY_KEY]
    : [];
  return history
    .map(sanitizeHistoryItem)
    .filter(Boolean)
    .sort((left, right) => right.occurredAt - left.occurredAt)
    .slice(0, MAX_HISTORY_ITEMS);
}

async function recordActivity(entry, url, outcome) {
  const history = await loadActivityHistory();
  history.unshift({
    id: createId(),
    hostname: normalizeHostname(url.hostname),
    pattern: formatPattern(entry),
    outcome,
    passwordType:
      entry.auth.kind === "pbkdf2-sha256" ? "custom" : entry.auth.kind,
    occurredAt: Date.now(),
  });
  await chrome.storage.local.set({
    [HISTORY_KEY]: history.slice(0, MAX_HISTORY_ITEMS),
  });
}

async function unlockTarget(message, sender) {
  if (!trustedLockPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }

  const entries = await loadEntries();
  const context = resolveTarget(message.target, entries);
  if (!context) {
    return { ok: false, reason: "missing_context" };
  }
  if (!(await hasPermissionForUrl(context.entry, context.url))) {
    return { ok: false, reason: "permission_missing" };
  }

  const validation = await validateCredential(
    context.entry,
    message.credential
  );
  if (!validation.ok) {
    await recordActivity(context.entry, context.url, "failure").catch(
      (error) => {
        console.error("Impossible d’enregistrer l’échec local.", error);
      }
    );
    return validation;
  }

  await allowEntryInTab(context.entry, sender.tab.id);
  await recordActivity(context.entry, context.url, "success").catch((error) => {
    console.error("Impossible d’enregistrer la réussite locale.", error);
  });
  return {
    ok: true,
    destination: context.url.href,
    hostname: context.url.hostname,
  };
}

function queueCredentialTask(task) {
  const queuedTask = credentialQueue
    .catch(() => undefined)
    .then(task);
  credentialQueue = queuedTask.catch(() => undefined);
  return queuedTask;
}

function queueUnlock(message, sender) {
  return queueCredentialTask(() => unlockTarget(message, sender));
}

async function listSettings(sender) {
  if (!trustedOptionsPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }
  await rebuildDynamicRules();
  const [entries, history, sessionRules] = await Promise.all([
    loadEntries(),
    loadActivityHistory(),
    chrome.declarativeNetRequest.getSessionRules(),
  ]);
  const states = await Promise.all(entries.map(permissionState));
  const unlockedTabs = new Set(
    sessionRules.flatMap((rule) => rule.condition.tabIds ?? [])
  ).size;
  return {
    ok: true,
    maxEntries: MAX_ENTRIES,
    unlockedTabs,
    history,
    entries: entries.map((entry, index) =>
      publicEntry(entry, states[index])
    ),
  };
}

function diagnosticRuleSnapshot(rule, entries) {
  const matchedEntry = entries.find(
    (entry) => rule.condition?.regexFilter === urlRegex(entry)
  );
  const snapshot = {
    id: Number.isInteger(rule.id) ? rule.id : 0,
    priority: Number.isInteger(rule.priority) ? rule.priority : 0,
    action: sanitizeDiagnosticText(rule.action?.type) ?? "unknown",
  };
  if (matchedEntry) {
    snapshot.hostname = matchedEntry.host;
    snapshot.pattern = formatPattern(matchedEntry);
  }
  const tabIds = Array.isArray(rule.condition?.tabIds)
    ? rule.condition.tabIds.filter(
        (tabId) => Number.isInteger(tabId) && tabId > 0
      )
    : [];
  if (tabIds.length > 0) {
    snapshot.tabIds = tabIds.slice(0, MAX_ENTRIES);
  }
  return snapshot;
}

async function diagnosticSnapshot() {
  const [entries, dynamicRules, sessionRules, granted] = await Promise.all([
    loadEntries(),
    chrome.declarativeNetRequest.getDynamicRules(),
    chrome.declarativeNetRequest.getSessionRules(),
    chrome.permissions.getAll().catch(() => ({
      origins: [],
      permissions: [],
    })),
  ]);
  const states = await Promise.all(entries.map(permissionState));
  const permissionPatterns = [
    ...new Set(
      (Array.isArray(granted.origins) ? granted.origins : [])
        .map(diagnosticPatternFromOrigin)
        .filter(Boolean)
    ),
  ].sort();
  const permissionNames = [
    ...new Set(
      (Array.isArray(granted.permissions) ? granted.permissions : [])
        .map(sanitizeDiagnosticText)
        .filter(Boolean)
    ),
  ].sort();

  return {
    entries: {
      count: entries.length,
      activeCount: states.filter((state) => state === "active").length,
      partialCount: states.filter((state) => state === "partial").length,
      missingCount: states.filter((state) => state === "missing").length,
      sites: entries.map((entry, index) => ({
        hostname: entry.host,
        pattern: formatPattern(entry),
        permissionState: states[index],
      })),
    },
    rules: {
      dynamicCount: dynamicRules.length,
      sessionCount: sessionRules.length,
      dynamic: dynamicRules.map((rule) =>
        diagnosticRuleSnapshot(rule, entries)
      ),
      session: sessionRules.map((rule) =>
        diagnosticRuleSnapshot(rule, entries)
      ),
    },
    permissions: {
      originCount: Array.isArray(granted.origins)
        ? granted.origins.length
        : 0,
      permissionCount: Array.isArray(granted.permissions)
        ? granted.permissions.length
        : 0,
      patterns: permissionPatterns,
      names: permissionNames,
    },
  };
}

async function getDiagnostics(sender) {
  if (!trustedOptionsPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }
  await diagnosticQueue.catch(() => undefined);
  const [events, snapshot] = await Promise.all([
    loadDiagnosticEventsNow(),
    diagnosticSnapshot(),
  ]);
  return {
    ok: true,
    diagnostics: {
      schema: DIAGNOSTIC_SCHEMA,
      buildId: DIAGNOSTIC_BUILD_ID,
      version: extensionVersion(),
      generatedAt: Date.now(),
      events,
      snapshot,
    },
  };
}

async function clearDiagnostics(sender) {
  if (!trustedOptionsPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }
  await clearDiagnosticEvents();
  return { ok: true };
}

async function clearUnlockHistory(sender) {
  if (!trustedOptionsPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }
  await chrome.storage.local.remove(HISTORY_KEY);
  return { ok: true };
}

async function saveSetting(message, sender) {
  if (!trustedOptionsPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }

  let parsed;
  try {
    parsed = SiteLockDomains.parseUserInput(message.rawSite);
  } catch (error) {
    return {
      ok: false,
      reason: error?.code ?? "invalid_site",
    };
  }

  const entries = await loadEntries();
  const existing = safeId(message.id)
    ? entries.find((entry) => entry.id === message.id)
    : null;
  if (message.id && !existing) {
    return { ok: false, reason: "not_found" };
  }
  if (!existing && entries.length >= MAX_ENTRIES) {
    return { ok: false, reason: "entry_limit" };
  }

  const includeSubdomains =
    parsed.includeSubdomains || message.includeSubdomains === true;
  if (
    existing &&
    (
      existing.host !== parsed.host ||
      existing.includeSubdomains !== includeSubdomains
    )
  ) {
    return { ok: false, reason: "immutable_scope" };
  }
  const duplicate = entries.find(
    (entry) =>
      entry.id !== existing?.id &&
      entry.host === parsed.host &&
      entry.includeSubdomains === includeSubdomains
  );
  if (duplicate) {
    return { ok: false, reason: "duplicate" };
  }

  let auth;
  if (message.passwordType === "clock") {
    auth = { kind: "clock" };
  } else if (message.passwordType === "reverse-clock") {
    auth = { kind: "reverse-clock" };
  } else if (message.passwordType === "custom") {
    if (typeof message.password === "string" && message.password.length > 0) {
      try {
        auth = await createVerifier(message.password);
      } catch (error) {
        return {
          ok: false,
          reason:
            error?.message === "password_too_short"
              ? "password_too_short"
              : "invalid_password",
        };
      }
    } else if (existing?.auth.kind === "pbkdf2-sha256") {
      auth = existing.auth;
    } else {
      return { ok: false, reason: "password_required" };
    }
  } else {
    return { ok: false, reason: "invalid_password_type" };
  }

  const now = Date.now();
  const entry = {
    schema: ENTRY_SCHEMA,
    id: existing?.id ?? createId(),
    host: parsed.host,
    includeSubdomains,
    auth,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await chrome.storage.sync.set({ [siteStorageKey(entry.id)]: entry });
  if (
    existing &&
    permissionOrigin(existing) !== permissionOrigin(entry)
  ) {
    const remaining = entries
      .filter((candidate) => candidate.id !== existing.id)
      .concat(entry);
    await removeUnusedOrigin(existing, remaining);
  }
  await reconcileProtection("settings_save");
  return {
    ok: true,
    entry: publicEntry(entry, await permissionState(entry)),
  };
}

async function removeUnusedOrigin(removedEntry, remainingEntries) {
  const stillNeeded = remainingEntries.some(
    (entry) =>
      permissionOrigin(entry) === permissionOrigin(removedEntry)
  );
  if (stillNeeded) {
    return;
  }

  for (const origin of [
    permissionOrigin(removedEntry),
    permissionOriginForScheme(removedEntry, "http"),
    permissionOriginForScheme(removedEntry, "https"),
  ]) {
    try {
      await chrome.permissions.remove({ origins: [origin] });
    } catch {
      // The permission may already have been removed or normalized by Chrome.
    }
  }
}

async function deleteSetting(message, sender) {
  if (!trustedOptionsPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }
  if (!safeId(message.id)) {
    return { ok: false, reason: "not_found" };
  }

  const entries = await loadEntries();
  const removed = entries.find((entry) => entry.id === message.id);
  if (!removed) {
    return { ok: false, reason: "not_found" };
  }

  await chrome.storage.sync.remove(siteStorageKey(removed.id));
  await chrome.storage.session.remove(attemptStorageKey(removed.id));
  const remaining = entries.filter((entry) => entry.id !== removed.id);
  await removeUnusedOrigin(removed, remaining);
  await reconcileProtection("settings_delete");
  return { ok: true };
}

async function popupStatus(sender) {
  if (!trustedPopupPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }
  await rebuildDynamicRules();
  const entries = await loadEntries();
  const states = await Promise.all(entries.map(permissionState));
  return {
    ok: true,
    total: entries.length,
    active: states.filter((state) => state === "active").length,
  };
}

const MASTER_MESSAGE_TYPES = new Set([
  "settings.masterStatus",
  "settings.masterCreate",
  "settings.masterUnlock",
  "settings.masterLock",
  "settings.masterChange",
]);

async function handleMessage(message, sender) {
  if (
    message?.type?.startsWith("settings.") &&
    !MASTER_MESSAGE_TYPES.has(message.type)
  ) {
    if (!trustedOptionsPage(sender)) {
      return { ok: false, reason: "unauthorized_sender" };
    }
    const masterState = await loadMasterAccessState(sender.tab.id);
    if (!masterState.configured || !masterState.unlocked) {
      return { ok: false, reason: "master_required" };
    }
  }

  switch (message?.type) {
    case "lock.getContext":
      return lockContext(message, sender);
    case "lock.unlock":
      return queueUnlock(message, sender);
    case "settings.masterStatus":
      return masterStatus(sender);
    case "settings.masterCreate":
      return queueCredentialTask(() => masterCreate(message, sender));
    case "settings.masterUnlock":
      return queueCredentialTask(() => masterUnlock(message, sender));
    case "settings.masterLock":
      return queueCredentialTask(() => masterLock(sender));
    case "settings.masterChange":
      return queueCredentialTask(() => masterChange(message, sender));
    case "settings.list":
      return listSettings(sender);
    case "settings.save":
      return saveSetting(message, sender);
    case "settings.delete":
      return deleteSetting(message, sender);
    case "settings.rebuild":
      if (!trustedOptionsPage(sender)) {
        return { ok: false, reason: "unauthorized_sender" };
      }
      await rebuildDynamicRules();
      return { ok: true };
    case "settings.lockAll":
      if (!trustedOptionsPage(sender)) {
        return { ok: false, reason: "unauthorized_sender" };
      }
      return { ok: true, reloaded: await lockAllProtectedTabs() };
    case "settings.clearHistory":
      return clearUnlockHistory(sender);
    case "settings.getDiagnostics":
      return getDiagnostics(sender);
    case "settings.clearDiagnostics":
      return clearDiagnostics(sender);
    case "popup.status":
      return popupStatus(sender);
    case "popup.lockAll":
      if (!trustedPopupPage(sender)) {
        return { ok: false, reason: "unauthorized_sender" };
      }
      return { ok: true, reloaded: await lockAllProtectedTabs() };
    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    !message ||
    typeof message.type !== "string" ||
    (
      !message.type.startsWith("lock.") &&
      !message.type.startsWith("settings.") &&
      !message.type.startsWith("popup.")
    )
  ) {
    return false;
  }

  handleMessage(message, sender)
    .then((response) => sendResponse(response ?? {
      ok: false,
      reason: "unknown_message",
    }))
    .catch((error) => {
      console.error("SiteLock a rencontré une erreur.", error);
      sendResponse({ ok: false, reason: "internal_error" });
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  fallbackRedirectTargets.delete(tabId);
  tabNavigationRevisions.delete(tabId);
  tabNavigationUrls.delete(tabId);

  chrome.storage.session
    .get(MASTER_UNLOCKED_KEY)
    .then((stored) => {
      if (stored[MASTER_UNLOCKED_KEY]?.tabId === tabId) {
        return chrome.storage.session.remove(MASTER_UNLOCKED_KEY);
      }
      return undefined;
    })
    .catch(() => undefined);

  chrome.declarativeNetRequest
    .getSessionRules()
    .then(async (rules) => {
      const ids = rules
        .filter((rule) => rule.condition.tabIds?.includes(tabId))
        .map((rule) => rule.id);
      if (ids.length > 0) {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: ids,
        });
      }
      await recordDiagnostic("tab.closed", {
        result: ids.length > 0 ? "unlock_removed" : "no_unlock_rule",
        tabId,
        removedRuleCount: ids.length,
        sessionRuleCount: rules.length - ids.length,
      }).catch(() => undefined);
    })
    .catch((error) => {
      console.error("Impossible de fermer la session SiteLock.", error);
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    typeof changeInfo.url !== "string" &&
    changeInfo.status !== "complete"
  ) {
    return;
  }

  const visibleUrl =
    typeof changeInfo.url === "string"
      ? changeInfo.url
      : typeof tab?.url === "string"
        ? tab.url
        : "";
  const revision = registerTabNavigation(
    tabId,
    visibleUrl,
    typeof changeInfo.url === "string"
  );
  const revisionAtStart = protectionRevision;

  reconcileTabNavigation(
    tabId,
    visibleUrl,
    revision,
    revisionAtStart,
    typeof changeInfo.url === "string"
  ).catch((error) => {
    console.error(
      "Impossible de réconcilier la protection SiteLock de cet onglet.",
      error
    );
  });
});

chrome.windows.onRemoved.addListener(() => {
  chrome.windows
    .getAll()
    .then(async (windows) => {
      await recordDiagnostic("window.removed", {
        result: windows.length === 0 ? "final_window" : "windows_remaining",
        windowCount: windows.length,
      }).catch(() => undefined);
      if (windows.length === 0) {
        const removedRuleCount = await removeAllSessionRules();
        await recordDiagnostic("window.final_closed", {
          result: "unlocks_cleared",
          windowCount: 0,
          removedRuleCount,
          sessionRuleCount: 0,
        }).catch(() => undefined);
      }
    })
    .catch((error) => {
      console.error(
        "Impossible de fermer les déverrouillages SiteLock.",
        error
      );
    });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[MASTER_VERIFIER_KEY]) {
    queueCredentialTask(async () => {
      const [verifier, stored] = await Promise.all([
        loadMasterVerifier(),
        chrome.storage.session.get(MASTER_UNLOCKED_KEY),
      ]);
      await chrome.storage.session.remove(MASTER_ATTEMPT_KEY);
      if (
        !verifier ||
        stored[MASTER_UNLOCKED_KEY]?.verifierDigest !== verifier.digest
      ) {
        await chrome.storage.session.remove(MASTER_UNLOCKED_KEY);
      }
    }).catch((error) => {
      console.error(
        "Impossible de verrouiller les réglages synchronisés.",
        error
      );
    });
  }

  if (
    areaName === "sync" &&
    Object.keys(changes).some((key) => key.startsWith(SITE_KEY_PREFIX))
  ) {
    protectionRevision += 1;
    navigationEntriesCache = null;
    (async () => {
      const entries = await loadEntries();
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith(SITE_KEY_PREFIX) || !change.oldValue) {
          continue;
        }
        const previous = sanitizeEntry(change.oldValue, key);
        const next = change.newValue
          ? sanitizeEntry(change.newValue, key)
          : null;
        if (
          previous &&
          (!next ||
            permissionOrigin(previous) !== permissionOrigin(next))
        ) {
          await removeUnusedOrigin(previous, entries);
        }
      }
      await reconcileProtection("sync_changed");
    })().catch((error) => {
      console.error("Impossible d'appliquer les réglages synchronisés.", error);
    });
  }
});

function handlePermissionChange(change, trigger) {
  protectionRevision += 1;
  const origins = Array.isArray(change?.origins) ? change.origins : [];
  const permissions = Array.isArray(change?.permissions)
    ? change.permissions
    : [];
  const pattern =
    origins.length === 1
      ? diagnosticPatternFromOrigin(origins[0])
      : null;
  recordDiagnostic(`permissions.${trigger}`, {
    result: "changed",
    pattern,
    permissionOriginCount: origins.length,
    permissionNameCount: permissions.length,
  }).catch(() => undefined);
  reconcileProtection(`permission_${trigger}`).catch((error) => {
    console.error("Impossible d'appliquer les autorisations SiteLock.", error);
  });
}

chrome.permissions.onAdded.addListener((change) =>
  handlePermissionChange(change, "added")
);
chrome.permissions.onRemoved.addListener((change) =>
  handlePermissionChange(change, "removed")
);

async function migrateLegacySkellock(previousVersion) {
  const majorVersion = Number.parseInt(previousVersion?.split(".")[0], 10);
  if (!Number.isInteger(majorVersion) || majorVersion >= 2) {
    return false;
  }

  const stored = await chrome.storage.sync.get(null);
  const existingSiteKeys = Object.keys(stored).filter((key) =>
    key.startsWith(SITE_KEY_PREFIX)
  );
  const metadata = stored[META_KEY];
  if (metadata?.legacyMigrationDone) {
    return false;
  }

  const updates = {
    [META_KEY]: {
      schema: SETTINGS_SCHEMA,
      legacyMigrationDone: true,
    },
  };
  if (existingSiteKeys.length === 0) {
    const now = Date.now();
    updates[siteStorageKey(LEGACY_ENTRY_ID)] = {
      schema: ENTRY_SCHEMA,
      id: LEGACY_ENTRY_ID,
      host: "skello.io",
      includeSubdomains: true,
      auth: { kind: "clock" },
      createdAt: now,
      updatedAt: now,
    };
  }
  await chrome.storage.sync.set(updates);
  return true;
}

chrome.runtime.onInstalled.addListener((details) => {
  (async () => {
    await recordDiagnostic("worker.installed", {
      result: sanitizeDiagnosticText(details.reason) ?? "unknown",
    }).catch(() => undefined);
    await setTrustedStorageAccess();
    const migrated =
      details.reason === "update"
        ? await migrateLegacySkellock(details.previousVersion)
        : false;
    await reconcileProtection("installed");
    if (details.reason === "install" || migrated) {
      const mode = details.reason === "install" ? "welcome" : "migrated";
      await chrome.tabs.create({
        url: `${OPTIONS_PAGE_URL}?${mode}=1`,
      });
    }
  })().catch((error) => {
    recordDiagnostic("worker.install_failed", {
      result: "error",
    }).catch(() => undefined);
    console.error("Impossible d'initialiser SiteLock.", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  recordDiagnostic("worker.startup", {
    result: "started",
  }).catch(() => undefined);
  reconcileProtection("startup").catch((error) => {
    recordDiagnostic("worker.startup_failed", {
      result: "error",
    }).catch(() => undefined);
    console.error("Impossible de restaurer les protections SiteLock.", error);
  });
});

recordDiagnostic("worker.loaded", {
  result: "ready",
}).catch(() => undefined);
setTrustedStorageAccess().catch(() => undefined);
rebuildDynamicRules().catch((error) => {
  recordDiagnostic("worker.load_rules_failed", {
    result: "error",
  }).catch(() => undefined);
  console.error("Impossible de charger les protections SiteLock.", error);
});
