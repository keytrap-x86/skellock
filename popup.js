const statusText = document.getElementById("statusText");
const lockButton = document.getElementById("lockButton");
const settingsButton = document.getElementById("settingsButton");
const feedback = document.getElementById("feedback");

async function loadStatus() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "popup.status",
    });
    if (!response?.ok) {
      throw new Error(response?.reason);
    }

    if (response.total === 0) {
      statusText.textContent = "Aucun site protégé";
      lockButton.disabled = true;
      settingsButton.textContent = "Ajouter un site";
      return;
    }

    statusText.textContent =
      `${response.active} site${response.active > 1 ? "s" : ""} actif${
        response.active > 1 ? "s" : ""
      } sur ${response.total}`;
  } catch (error) {
    console.error("Impossible de charger SiteLock.", error);
    statusText.textContent = "État indisponible";
  }
}

lockButton.addEventListener("click", async () => {
  lockButton.disabled = true;
  feedback.textContent = "Reverrouillage…";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "popup.lockAll",
    });
    if (!response?.ok) {
      throw new Error(response?.reason);
    }
    feedback.textContent = "Tous les sites sont verrouillés.";
  } catch (error) {
    console.error("Impossible de reverrouiller les sites.", error);
    feedback.textContent = "Le reverrouillage a échoué.";
  } finally {
    lockButton.disabled = false;
  }
});

settingsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

loadStatus();
