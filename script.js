const form = document.getElementById("unlockForm");
const input = document.getElementById("passwordInput");
const submitButton = document.getElementById("submitButton");
const status = document.getElementById("formStatus");
const intro = document.getElementById("introText");
const target = window.location.hash.slice(1);

let retryTimer;
let retryActive = false;
let destinationHostname = "ce site";
let contextReady = false;

function setStatus(message, type = "") {
  status.textContent = message;
  status.dataset.type = type;
}

function setSubmitting(isSubmitting) {
  input.disabled = isSubmitting || !contextReady;
  submitButton.disabled = isSubmitting || !contextReady;
  submitButton.textContent = isSubmitting ? "Vérification…" : "Continuer";
}

function focusInput() {
  window.requestAnimationFrame(() => {
    if (contextReady && !input.disabled) {
      input.focus({ preventScroll: true });
    }
  });
}

function showContextError(reason) {
  contextReady = false;
  form.setAttribute("aria-busy", "false");
  intro.textContent =
    reason === "permission_missing"
      ? "SiteLock n’est pas autorisé à ouvrir ce site sur cet appareil."
      : "SiteLock ne retrouve pas le site à ouvrir.";
  setStatus(
    "Cette protection n’est pas disponible sur cet appareil.",
    "error"
  );
  setSubmitting(false);
}

async function loadContext() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "lock.getContext",
      target,
    });
    if (!response?.ok) {
      showContextError(response?.reason);
      return;
    }

    destinationHostname = response.site.hostname;
    intro.textContent =
      `Saisissez le code d’accès pour continuer vers ${destinationHostname}.`;
    contextReady = true;
    form.setAttribute("aria-busy", "false");
    setSubmitting(false);
    focusInput();
  } catch (error) {
    console.error("Impossible de contacter SiteLock.", error);
    showContextError("internal_error");
  }
}

function startRetryCountdown(seconds) {
  window.clearInterval(retryTimer);
  retryActive = true;
  input.disabled = true;
  submitButton.disabled = true;

  let remaining = Math.max(1, seconds);
  const render = () => {
    setStatus(
      `Trop de tentatives. Réessayez dans ${remaining} seconde${
        remaining > 1 ? "s" : ""
      }.`,
      "error"
    );
  };

  render();
  retryTimer = window.setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      window.clearInterval(retryTimer);
      retryActive = false;
      setSubmitting(false);
      setStatus("Vous pouvez réessayer.");
      focusInput();
      return;
    }
    render();
  }, 1000);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");

  if (!contextReady) {
    return;
  }
  if (!input.value) {
    setStatus("Saisissez votre code d’accès.", "error");
    input.focus();
    return;
  }

  setSubmitting(true);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "lock.unlock",
      credential: input.value,
      target,
    });

    if (response?.ok) {
      setStatus(
        `Code accepté. Ouverture de ${response.hostname ?? destinationHostname}…`,
        "success"
      );
      window.location.replace(response.destination);
      return;
    }

    input.value = "";
    if (response?.reason === "rate_limited") {
      startRetryCountdown(response.retryAfterSeconds ?? 30);
      return;
    }
    if (response?.reason === "invalid_code") {
      const attempts = response.remainingAttempts;
      const suffix =
        Number.isInteger(attempts) && attempts > 0
          ? ` ${attempts} tentative${attempts > 1 ? "s" : ""} restante${
              attempts > 1 ? "s" : ""
            }.`
          : "";
      setStatus(`Code incorrect.${suffix}`, "error");
      return;
    }
    if (
      response?.reason === "missing_context" ||
      response?.reason === "permission_missing"
    ) {
      showContextError(response.reason);
      return;
    }
    setStatus("Le déverrouillage a échoué. Réessayez.", "error");
  } catch (error) {
    console.error("Impossible de contacter SiteLock.", error);
    setStatus("Le déverrouillage a échoué. Réessayez.", "error");
  } finally {
    if (contextReady && !retryActive) {
      setSubmitting(false);
      focusInput();
    }
  }
});

loadContext();
