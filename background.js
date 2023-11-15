// Store tabs & urls
var tabToUrl = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.unlock) {
    handleUnlockRequest(sendResponse);
  }
  return true; // Pour gérer la réponse de manière asynchrone.
});

async function handleUnlockRequest(sendResponse) {
  await unblockSkello(sendResponse);
}

const blockSkello = async () => {
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [
      {
        id: 1,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { extensionPath: "/lock.html" },
        },
        condition: {
          urlFilter: "*://*.skello.io/*",
          resourceTypes: ["main_frame"],
        },
      },
    ],
    removeRuleIds: [1], // Assure-toi de supprimer l'ancienne règle de blocage.
  });
};

const unblockSkello = async (sendResponse) => {
  try {
    // Supprime la règle de blocage si le mot de passe est correct.
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: "allow",
          },
          condition: {
            urlFilter: "*://*.skello.io/*",
            resourceTypes: ["main_frame"],
          },
        },
      ],
      removeRuleIds: [1], // Assure-toi de supprimer l'ancienne règle de blocage.
    });
    console.log("Site débloqué !");
    // Trouve l'onglet actif et recharge-le.
    sendResponse({ unlocked: true });
  } catch (error) {
    console.error("Erreur lors de la suppression de la règle :", error);
    sendResponse({ error: error.message });
  }
};

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  console.log(tabToUrl);
  if (tab.url && tab.url.includes("skello.io")) {
    tabToUrl.set(tabId, tab.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  // Supprimer les onglets de la carte
  tabToUrl.delete(tabId);
  // Vérifier s'il ne reste plus d'onglets ouverts avec skello.io
  var hasSkelloTab = [...tabToUrl.values()].some((url) =>
    url.includes("skello.io")
  );

  // Check if the tab url contains skello.io
  if (!hasSkelloTab) {
    // Update dynamic rules to block skello.io
    chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: "redirect",
            redirect: { extensionPath: "/lock.html" },
          },
          condition: {
            urlFilter: "*://*.skello.io/*",
            resourceTypes: ["main_frame"],
          },
        },
      ],
      removeRuleIds: [1], // Assure-toi de supprimer l'ancienne règle de blocage.
    });
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await blockSkello();
  console.log("Site bloqué !");
});

chrome.runtime.onStartup.addListener(async () => {
  await blockSkello();
  console.log("Site bloqué !");
});
