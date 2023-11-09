chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.unlock) {
    handleUnlockRequest(sendResponse);
  }
  return true; // Pour gérer la réponse de manière asynchrone.
});

async function handleUnlockRequest(sendResponse) {
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
}

// Store tabs & urls
var tabToUrl = {};

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tab.url && tab.url.includes("skello.io")) {
    tabToUrl[tabId] = tab.url;
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  var url = tabToUrl[tabId];

  // Check if the tab url contains skello.io
  if (url && url.includes("skello.io")) {
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

    tabToUrl = {};
  }
});
