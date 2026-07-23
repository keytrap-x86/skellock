const form = document.getElementById("unlockForm");
const input = document.getElementById("passwordInput");
const submitButton = document.getElementById("submitButton");
const status = document.getElementById("formStatus");

let retryTimer;

function setStatus(message, type = "") {
  status.textContent = message;
  status.dataset.type = type;
}

function setSubmitting(isSubmitting) {
  input.disabled = isSubmitting;
  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting ? "Vérification…" : "Continuer";
}

function startRetryCountdown(seconds) {
  window.clearInterval(retryTimer);
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
      input.disabled = false;
      submitButton.disabled = false;
      submitButton.textContent = "Continuer";
      setStatus("Vous pouvez réessayer.");
      input.focus();
      return;
    }
    render();
  }, 1000);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");

  if (!input.validity.valid) {
    setStatus("Saisissez un code à 4 chiffres.", "error");
    input.focus();
    return;
  }

  setSubmitting(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "unlock",
      code: input.value,
    });

    if (response?.ok) {
      setStatus("Code accepté. Ouverture de Skello…", "success");
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

    setStatus("Le déverrouillage a échoué. Réessayez.", "error");
  } catch (error) {
    console.error("Impossible de contacter Skellock.", error);
    setStatus("Le déverrouillage a échoué. Réessayez.", "error");
  } finally {
    if (!input.disabled) {
      setSubmitting(false);
      input.focus();
    }
  }
});
