document.getElementById("submitButton").addEventListener("click", function () {
  let userInput = document.getElementById("passwordInput").value;
  let expectedPassword = new Date()
    .toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(/:/g, "");

  if (userInput === expectedPassword) {
    // Si le mot de passe est correct, envoie un message au script de fond pour débloquer le site
    chrome.runtime.sendMessage({ unlock: true }, function (response) {
      if (response.unlocked) {
        window.location.href = "https://app.skello.io/";
      } else if (response.error) {
        // Affiche l'erreur si quelque chose ne va pas
        alert("Erreur : " + response.error);
      }
    });
  } else {
    // Affiche un message d'erreur ou réinitialise le champ de saisie
    alert("Mot de passe incorrect.");
    document.getElementById("passwordInput").value = "";
  }
});
