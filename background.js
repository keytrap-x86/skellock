const LOCK_PAGE_URL = chrome.runtime.getURL("lock.html");
const SKELLO_DESTINATION = "https://app.skello.io/";
const SKELLO_URL_PATTERN = "https://*.skello.io/*";
const SKELLO_FILTER = "||skello.io^";
const UNLOCK_RULE_PRIORITY = 200;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30_000;

const attemptsByTab = new Map();

function expectedAccessCode() {
  return new Date()
    .toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(/:/g, "");
}

function isTrustedLockPage(sender) {
  return (
    sender.id === chrome.runtime.id &&
    sender.url === LOCK_PAGE_URL &&
    (sender.frameId === undefined || sender.frameId === 0) &&
    Number.isInteger(sender.tab?.id) &&
    sender.tab.id > 0
  );
}

function validateAccessCode(code, tabId) {
  const now = Date.now();
  const state = attemptsByTab.get(tabId);

  if (state?.blockedUntil > now) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: Math.ceil((state.blockedUntil - now) / 1000),
    };
  }

  if (typeof code !== "string" || !/^\d{4}$/.test(code)) {
    return registerFailedAttempt(tabId, now);
  }

  if (code !== expectedAccessCode()) {
    return registerFailedAttempt(tabId, now);
  }

  attemptsByTab.delete(tabId);
  return { ok: true };
}

function registerFailedAttempt(tabId, now) {
  const previousAttempts = attemptsByTab.get(tabId)?.failedAttempts ?? 0;
  const failedAttempts = previousAttempts + 1;

  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    const blockedUntil = now + LOCKOUT_DURATION_MS;
    attemptsByTab.set(tabId, { failedAttempts: 0, blockedUntil });
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: Math.ceil(LOCKOUT_DURATION_MS / 1000),
    };
  }

  attemptsByTab.set(tabId, { failedAttempts, blockedUntil: 0 });
  return {
    ok: false,
    reason: "invalid_code",
    remainingAttempts: MAX_FAILED_ATTEMPTS - failedAttempts,
  };
}

async function unlockTab(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: [
      {
        id: tabId,
        priority: UNLOCK_RULE_PRIORITY,
        action: {
          type: "allow",
        },
        condition: {
          urlFilter: SKELLO_FILTER,
          resourceTypes: ["main_frame"],
          tabIds: [tabId],
        },
      },
    ],
  });
}

async function handleUnlockRequest(message, sender) {
  if (!isTrustedLockPage(sender)) {
    return { ok: false, reason: "unauthorized_sender" };
  }

  const validation = validateAccessCode(message.code, sender.tab.id);
  if (!validation.ok) {
    return validation;
  }

  await unlockTab(sender.tab.id);
  return { ok: true, destination: SKELLO_DESTINATION };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "unlock") {
    return false;
  }

  handleUnlockRequest(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error("Impossible de déverrouiller Skello.", error);
      sendResponse({ ok: false, reason: "internal_error" });
    });

  return true;
});

async function removeUnlockRule(tabId) {
  attemptsByTab.delete(tabId);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  removeUnlockRule(tabId).catch((error) => {
    console.error("Impossible de supprimer la règle de l'onglet fermé.", error);
  });
});

async function clearLegacyDynamicRules() {
  const legacyRules = await chrome.declarativeNetRequest.getDynamicRules();
  if (legacyRules.length === 0) {
    return;
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: legacyRules.map((rule) => rule.id),
  });
}

async function lockAllSkelloTabs() {
  const sessionRules = await chrome.declarativeNetRequest.getSessionRules();
  if (sessionRules.length > 0) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: sessionRules.map((rule) => rule.id),
    });
  }

  attemptsByTab.clear();

  const tabs = await chrome.tabs.query({ url: [SKELLO_URL_PATTERN] });
  await Promise.allSettled(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) => chrome.tabs.reload(tab.id))
  );
}

function relockAndReportErrors() {
  lockAllSkelloTabs().catch((error) => {
    console.error("Impossible de reverrouiller Skello.", error);
  });
}

chrome.action.onClicked.addListener(relockAndReportErrors);
chrome.runtime.onStartup.addListener(relockAndReportErrors);
chrome.runtime.onInstalled.addListener(() => {
  Promise.all([clearLegacyDynamicRules(), lockAllSkelloTabs()]).catch((error) => {
    console.error("Impossible d'initialiser Skellock.", error);
  });
});

clearLegacyDynamicRules().catch((error) => {
  console.error("Impossible de supprimer les anciennes règles.", error);
});
