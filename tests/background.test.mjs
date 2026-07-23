import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const backgroundSource = await readFile(
  new URL("../background.js", import.meta.url),
  "utf8"
);

function createHarness() {
  const listeners = {};
  const sessionRules = new Map();
  const dynamicRules = new Map();
  const reloadedTabs = [];

  const event = (name) => ({
    addListener(listener) {
      listeners[name] = listener;
    },
  });

  const chrome = {
    runtime: {
      id: "extension-id",
      getURL: (path) => `chrome-extension://extension-id/${path}`,
      onMessage: event("message"),
      onStartup: event("startup"),
      onInstalled: event("installed"),
    },
    action: {
      onClicked: event("action"),
    },
    tabs: {
      onRemoved: event("removed"),
      query: async () => [{ id: 37, url: "https://app.skello.io/" }],
      reload: async (tabId) => {
        reloadedTabs.push(tabId);
      },
    },
    declarativeNetRequest: {
      getDynamicRules: async () => [...dynamicRules.values()],
      updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }) => {
        removeRuleIds.forEach((id) => dynamicRules.delete(id));
        addRules.forEach((rule) => dynamicRules.set(rule.id, rule));
      },
      getSessionRules: async () => [...sessionRules.values()],
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
        removeRuleIds.forEach((id) => sessionRules.delete(id));
        addRules.forEach((rule) => sessionRules.set(rule.id, rule));
      },
    },
  };

  class FixedDate {
    static now() {
      return 1_000_000;
    }

    toLocaleTimeString() {
      return "09:42";
    }
  }

  vm.runInNewContext(backgroundSource, {
    chrome,
    console,
    Date: FixedDate,
    Map,
    Number,
    Promise,
    RegExp,
  });

  const sender = {
    id: "extension-id",
    url: "chrome-extension://extension-id/lock.html",
    frameId: 0,
    tab: { id: 37 },
  };

  async function send(message, messageSender = sender) {
    return new Promise((resolve, reject) => {
      const keptOpen = listeners.message(message, messageSender, resolve);
      if (!keptOpen) {
        reject(new Error("message channel was not kept open"));
      }
    });
  }

  return {
    listeners,
    sessionRules,
    dynamicRules,
    reloadedTabs,
    sender,
    send,
  };
}

test("only the expected clock code unlocks the sender tab", async () => {
  const harness = createHarness();

  const wrong = await harness.send({ type: "unlock", code: "0000" });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, "invalid_code");
  assert.equal(harness.sessionRules.size, 0);

  const correct = await harness.send({ type: "unlock", code: "0942" });
  assert.equal(correct.ok, true);
  assert.equal(correct.destination, "https://app.skello.io/");

  const rule = harness.sessionRules.get(37);
  assert.equal(rule.action.type, "allow");
  assert.equal(rule.priority, 200);
  assert.deepEqual([...rule.condition.tabIds], [37]);
  assert.equal(rule.condition.urlFilter, "||skello.io^");
});

test("a non-lock-page sender cannot unlock", async () => {
  const harness = createHarness();
  const response = await harness.send(
    { type: "unlock", code: "0942" },
    {
      ...harness.sender,
      url: "chrome-extension://extension-id/other.html",
    }
  );

  assert.equal(response.ok, false);
  assert.equal(response.reason, "unauthorized_sender");
  assert.equal(harness.sessionRules.size, 0);
});

test("the legacy unauthenticated unlock message is ignored", () => {
  const harness = createHarness();
  let responseSent = false;

  const keptOpen = harness.listeners.message(
    { unlock: true },
    harness.sender,
    () => {
      responseSent = true;
    }
  );

  assert.equal(keptOpen, false);
  assert.equal(responseSent, false);
  assert.equal(harness.sessionRules.size, 0);
});

test("five failed attempts temporarily rate-limit a tab", async () => {
  const harness = createHarness();

  for (let index = 0; index < 4; index += 1) {
    const response = await harness.send({ type: "unlock", code: "0000" });
    assert.equal(response.reason, "invalid_code");
  }

  const fifth = await harness.send({ type: "unlock", code: "0000" });
  assert.equal(fifth.reason, "rate_limited");
  assert.equal(fifth.retryAfterSeconds, 30);

  const blockedCorrectCode = await harness.send({
    type: "unlock",
    code: "0942",
  });
  assert.equal(blockedCorrectCode.reason, "rate_limited");
  assert.equal(harness.sessionRules.size, 0);
});

test("closing an unlocked tab removes its session rule", async () => {
  const harness = createHarness();
  await harness.send({ type: "unlock", code: "0942" });
  assert.equal(harness.sessionRules.size, 1);

  harness.listeners.removed(37);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.sessionRules.size, 0);
});

test("toolbar action removes unlock rules and reloads Skello tabs", async () => {
  const harness = createHarness();
  await harness.send({ type: "unlock", code: "0942" });

  harness.listeners.action();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.sessionRules.size, 0);
  assert.deepEqual(harness.reloadedTabs, [37]);
});
