const {
  DomainInputError,
  formatPattern,
  parseUserInput,
  permissionOrigin,
} = SiteLockDomains;

const masterGate = document.getElementById("masterGate");
const masterGateForm = document.getElementById("masterGateForm");
const masterGateTitle = document.getElementById("masterGateTitle");
const masterGateIntro = document.getElementById("masterGateIntro");
const masterPasswordInput = document.getElementById("masterPasswordInput");
const masterConfirmField = document.getElementById("masterConfirmField");
const masterConfirmInput = document.getElementById("masterConfirmInput");
const masterGateStatus = document.getElementById("masterGateStatus");
const masterGateButton = document.getElementById("masterGateButton");
const optionsApp = document.getElementById("optionsApp");
const addSitePanel = document.getElementById("addSite");
const dashboardTopbar = document.querySelector(".dashboard-topbar");
const form = document.getElementById("siteForm");
const formTitle = document.getElementById("formTitle");
const siteInput = document.getElementById("siteInput");
const siteHelp = document.getElementById("siteHelp");
const sitePreview = document.getElementById("sitePreview");
const exactScopeHelp = document.getElementById("exactScopeHelp");
const wildcardScopeHelp = document.getElementById("wildcardScopeHelp");
const scopeFieldset = document.getElementById("scopeFieldset");
const scopeEditHelp = document.getElementById("scopeEditHelp");
const passwordInput = document.getElementById("passwordInput");
const passwordConfirmInput = document.getElementById("passwordConfirmInput");
const customPasswordFields = document.getElementById("customPasswordFields");
const formStatus = document.getElementById("formStatus");
const saveButton = document.getElementById("saveButton");
const cancelEditButton = document.getElementById("cancelEditButton");
const siteList = document.getElementById("siteList");
const siteTableWrap = document.getElementById("siteTableWrap");
const siteCount = document.getElementById("siteCount");
const loadingState = document.getElementById("loadingState");
const emptyState = document.getElementById("emptyState");
const activationBanner = document.getElementById("activationBanner");
const activationText = document.getElementById("activationText");
const activateAllButton = document.getElementById("activateAllButton");
const lockAllButton = document.getElementById("lockAllButton");
const welcomeBanner = document.getElementById("welcomeBanner");
const siteSearchInput = document.getElementById("siteSearchInput");
const totalSitesStat = document.getElementById("totalSitesStat");
const totalSitesDetail = document.getElementById("totalSitesDetail");
const activeSitesStat = document.getElementById("activeSitesStat");
const activeSitesDetail = document.getElementById("activeSitesDetail");
const unlockedTabsStat = document.getElementById("unlockedTabsStat");
const unlockedTabsDetail = document.getElementById("unlockedTabsDetail");
const missingPermissionsStat = document.getElementById(
  "missingPermissionsStat"
);
const missingPermissionsDetail = document.getElementById(
  "missingPermissionsDetail"
);
const failedAttemptsStat = document.getElementById("failedAttemptsStat");
const failedAttemptsDetail = document.getElementById("failedAttemptsDetail");
const noResultsState = document.getElementById("noResultsState");
const historyList = document.getElementById("historyList");
const historyEmptyState = document.getElementById("historyEmptyState");
const clearHistoryButton = document.getElementById("clearHistoryButton");
const diagnosticsDetails = document.getElementById("diagnosticsDetails");
const diagnosticsOutput = document.getElementById("diagnosticsOutput");
const copyDiagnosticsButton = document.getElementById(
  "copyDiagnosticsButton"
);
const refreshDiagnosticsButton = document.getElementById(
  "refreshDiagnosticsButton"
);
const clearDiagnosticsButton = document.getElementById(
  "clearDiagnosticsButton"
);
const lockOptionsButton = document.getElementById("lockOptionsButton");
const changeMasterButton = document.getElementById("changeMasterButton");
const changeMasterDialog = document.getElementById("changeMasterDialog");
const changeMasterForm = document.getElementById("changeMasterForm");
const currentMasterInput = document.getElementById("currentMasterInput");
const newMasterInput = document.getElementById("newMasterInput");
const newMasterConfirmInput = document.getElementById(
  "newMasterConfirmInput"
);
const changeMasterStatus = document.getElementById("changeMasterStatus");
const cancelMasterChangeButton = document.getElementById(
  "cancelMasterChangeButton"
);
const saveMasterChangeButton = document.getElementById(
  "saveMasterChangeButton"
);
const deleteDialog = document.getElementById("deleteDialog");
const deletePattern = document.getElementById("deletePattern");
const toast = document.getElementById("toast");

let entries = [];
let history = [];
let unlockedTabs = 0;
let maxEntries = 100;
let editingId = null;
let pendingDeleteId = null;
let reloadTimer;
let toastTimer;
let masterGateMode = "unlock";
let dashboardInitialized = false;
let masterMutationInFlight = false;
let suppressMasterVerifierReloadUntil = 0;

const MAX_FAVICON_BYTES = 256 * 1024;
const FAVICON_CONTENT_TYPES = new Set([
  "image/gif",
  "image/icon",
  "image/ico",
  "image/jpeg",
  "image/png",
  "image/vnd.microsoft.icon",
  "image/webp",
  "image/x-icon",
]);
const faviconCache = new Map();
const faviconObjectUrls = new Set();

const ERROR_MESSAGES = {
  invalid_site:
    "Saisissez une adresse ou un domaine valide, par exemple exemple.com.",
  wildcard_position:
    "Le caractère * est accepté uniquement au début, par exemple *.exemple.com.",
  unsupported_scheme: "Seuls les sites HTTP et HTTPS peuvent être protégés.",
  credentials_not_allowed:
    "Retirez l’identifiant ou le mot de passe présent dans cette adresse.",
  invalid_wildcard:
    "Les sous-domaines automatiques ne sont pas disponibles pour cette adresse.",
  duplicate: "Ce site est déjà protégé avec cette portée.",
  password_too_short: "Utilisez au moins 8 caractères.",
  password_required: "Saisissez le nouveau mot de passe.",
  invalid_password: "Ce mot de passe ne peut pas être utilisé.",
  invalid_master_password: "Le mot de passe maître est incorrect.",
  master_required: "Déverrouillez les réglages pour continuer.",
  master_already_configured:
    "Un mot de passe maître existe déjà. Rechargez la page.",
  master_not_configured:
    "Créez d’abord un mot de passe maître.",
  rate_limited: "Trop de tentatives. Patientez avant de réessayer.",
  immutable_scope:
    "Pour changer le domaine ou sa portée, supprimez cette règle puis ajoutez-en une nouvelle.",
  entry_limit: "La limite de sites protégés est atteinte.",
  not_found: "Ce réglage n’existe plus.",
  internal_error: "Une erreur est survenue. Réessayez.",
};

function selectedValue(name) {
  return form.elements[name].value;
}

function setSelectedValue(name, value) {
  const input = form.querySelector(
    `input[name="${name}"][value="${value}"]`
  );
  if (input) {
    input.checked = true;
  }
}

function setFormStatus(message, type = "") {
  formStatus.textContent = message;
  formStatus.dataset.type = type;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function setMasterGateStatus(message, type = "") {
  masterGateStatus.textContent = message;
  masterGateStatus.dataset.type = type;
}

function showMasterGate(mode) {
  masterGateMode = mode;
  optionsApp.hidden = true;
  masterGate.hidden = false;
  masterPasswordInput.value = "";
  masterConfirmInput.value = "";
  setMasterGateStatus("");

  const creating = mode === "create";
  masterConfirmField.hidden = !creating;
  masterConfirmInput.required = creating;
  masterPasswordInput.autocomplete = creating
    ? "new-password"
    : "current-password";
  masterGateTitle.textContent = creating
    ? "Créez votre mot de passe maître"
    : "Réglages verrouillés";
  masterGateIntro.textContent = creating
    ? "Choisissez un mot de passe d’au moins 8 caractères. Il sera demandé avant toute administration de SiteLock."
    : "Saisissez le mot de passe maître pour administrer les sites protégés.";
  masterGateButton.textContent = creating
    ? "Créer et ouvrir les réglages"
    : "Déverrouiller les réglages";

  window.requestAnimationFrame(() => {
    masterPasswordInput.focus({ preventScroll: true });
  });
}

function revealOptions() {
  masterGate.hidden = true;
  optionsApp.hidden = false;
  if (!dashboardInitialized) {
    dashboardInitialized = true;
    updatePasswordFields();
    applyFormMode();
    updatePreview();
    loadEntries();
  }

  window.requestAnimationFrame(() => {
    const target = window.location.hash
      ? document.getElementById(window.location.hash.slice(1))
      : null;
    target?.scrollIntoView({ block: "start" });
  });
}

async function initializeMasterProtection() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "settings.masterStatus",
    });
    if (!response?.ok) {
      throw new Error(response?.reason);
    }
    if (response.unlocked) {
      revealOptions();
      return;
    }
    showMasterGate(response.configured ? "unlock" : "create");
  } catch (error) {
    console.error("Impossible de vérifier le verrou maître.", error);
    showMasterGate("unlock");
    setMasterGateStatus(
      "Impossible de charger la protection des réglages. Actualisez la page.",
      "error"
    );
    masterGateButton.disabled = true;
  }
}

masterGateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMasterGateStatus("");

  const password = masterPasswordInput.value;
  if (password.length < 8) {
    setMasterGateStatus("Utilisez au moins 8 caractères.", "error");
    masterPasswordInput.focus();
    return;
  }
  if (masterGateMode === "create" && password !== masterConfirmInput.value) {
    setMasterGateStatus("Les mots de passe ne correspondent pas.", "error");
    masterConfirmInput.focus();
    return;
  }

  masterGateButton.disabled = true;
  masterPasswordInput.disabled = true;
  masterConfirmInput.disabled = true;
  masterGateForm.setAttribute("aria-busy", "true");
  masterMutationInFlight = masterGateMode === "create";
  if (masterMutationInFlight) {
    suppressMasterVerifierReloadUntil = Date.now() + 2_000;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type:
        masterGateMode === "create"
          ? "settings.masterCreate"
          : "settings.masterUnlock",
      password,
    });
    if (!response?.ok) {
      const message =
        response?.reason === "rate_limited" &&
        Number.isInteger(response.retryAfterSeconds)
          ? `Trop de tentatives. Réessayez dans ${response.retryAfterSeconds} secondes.`
          : ERROR_MESSAGES[response?.reason] ?? ERROR_MESSAGES.internal_error;
      setMasterGateStatus(message, "error");
      masterPasswordInput.value = "";
      masterConfirmInput.value = "";
      return;
    }
    revealOptions();
  } catch (error) {
    console.error("Impossible d’ouvrir les réglages.", error);
    setMasterGateStatus(ERROR_MESSAGES.internal_error, "error");
  } finally {
    masterMutationInFlight = false;
    masterGateButton.disabled = false;
    masterPasswordInput.disabled = false;
    masterConfirmInput.disabled = false;
    masterGateForm.setAttribute("aria-busy", "false");
    if (!masterGate.hidden) {
      masterPasswordInput.focus();
    }
  }
});

function currentSiteCandidate() {
  const parsed = parseUserInput(siteInput.value);
  return {
    host: parsed.host,
    includeSubdomains:
      parsed.includeSubdomains || selectedValue("scope") === "subdomains",
  };
}

function updatePreview() {
  if (!siteInput.value.trim()) {
    sitePreview.textContent = "";
    exactScopeHelp.textContent = "Protège uniquement le domaine saisi.";
    wildcardScopeHelp.textContent = "Protège aussi tous ses sous-domaines.";
    return;
  }

  try {
    const parsed = parseUserInput(siteInput.value);
    if (parsed.includeSubdomains) {
      setSelectedValue("scope", "subdomains");
    }
    const candidate = currentSiteCandidate();
    sitePreview.textContent = `Site reconnu : ${formatPattern(candidate)}`;
    exactScopeHelp.textContent = `Protège uniquement ${parsed.host}.`;
    wildcardScopeHelp.textContent =
      `Protège ${parsed.host} et tous ses sous-domaines.`;
  } catch {
    sitePreview.textContent = "";
  }
}

function updatePasswordFields() {
  const isCustom = selectedValue("passwordType") === "custom";
  customPasswordFields.hidden = !isCustom;
  passwordInput.required =
    isCustom &&
    (!editingId ||
      entries.find((entry) => entry.id === editingId)?.passwordType !==
        "custom");
  passwordConfirmInput.required = passwordInput.required;
}

function applyFormMode() {
  const editing = Boolean(editingId);
  siteInput.readOnly = editing;
  for (const input of form.querySelectorAll('input[name="scope"]')) {
    input.disabled = editing;
  }
  scopeFieldset.classList.toggle("scope-fieldset-locked", editing);
  scopeEditHelp.hidden = !editing;
  siteHelp.textContent = editing
    ? "Pour changer le domaine, supprimez cette règle puis ajoutez-en une nouvelle."
    : "Collez une adresse complète ou saisissez un domaine. Le chemin, les paramètres et le port seront ignorés.";
}

function submitButtonLabel() {
  return editingId
    ? "Enregistrer les modifications"
    : "Ajouter et autoriser";
}

function resetForm() {
  editingId = null;
  form.reset();
  siteInput.value = "";
  passwordInput.value = "";
  passwordConfirmInput.value = "";
  formTitle.textContent = "Protéger un site";
  saveButton.textContent = submitButtonLabel();
  cancelEditButton.hidden = true;
  setFormStatus("");
  updatePasswordFields();
  applyFormMode();
  updatePreview();
}

function setSaving(saving) {
  for (const control of form.querySelectorAll("input, button")) {
    control.disabled = saving;
  }
  siteList.inert = saving;
  saveButton.textContent = saving
    ? "Enregistrement…"
    : submitButtonLabel();
  if (!saving) {
    applyFormMode();
  }
}

function badge(text, className = "") {
  const element = document.createElement("span");
  element.className = `badge ${className}`.trim();
  element.textContent = text;
  return element;
}

function actionButton(text, action, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-button ${extraClass}`.trim();
  button.dataset.action = action;
  button.textContent = text;
  return button;
}

function passwordTypeLabel(type) {
  if (type === "reverse-clock") {
    return "Code inversé";
  }
  if (type === "custom") {
    return "Mot de passe";
  }
  return "Code dynamique";
}

function permissionBadge(entry) {
  if (entry.permissionState === "active") {
    return badge("Actif sur cet appareil", "badge-active");
  }
  if (entry.permissionState === "partial") {
    return badge("Autorisation partielle", "badge-warning");
  }
  return badge("Autorisation requise", "badge-warning");
}

function faviconCandidates(host) {
  const localHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    host.includes(":");
  const urlHost =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const origin = `${localHost ? "http" : "https"}://${urlHost}`;
  return [
    new URL("/favicon.ico", origin).href,
    new URL("/favicon.png", origin).href,
  ];
}

async function fetchFavicon(host) {
  for (const candidate of faviconCandidates(host)) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2_500);
    try {
      const response = await fetch(candidate, {
        cache: "force-cache",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (!response.ok) {
        continue;
      }

      const contentType = (
        response.headers.get("content-type") ?? ""
      )
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (!FAVICON_CONTENT_TYPES.has(contentType)) {
        continue;
      }

      const declaredLength = Number.parseInt(
        response.headers.get("content-length") ?? "",
        10
      );
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_FAVICON_BYTES
      ) {
        continue;
      }

      const bytes = await response.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_FAVICON_BYTES) {
        continue;
      }

      const objectUrl = URL.createObjectURL(
        new Blob([bytes], { type: contentType })
      );
      faviconObjectUrls.add(objectUrl);
      return objectUrl;
    } catch {
      // The generic site icon remains visible.
    } finally {
      window.clearTimeout(timeout);
    }
  }
  return null;
}

function faviconUrl(host) {
  if (!faviconCache.has(host)) {
    faviconCache.set(host, fetchFavicon(host));
  }
  return faviconCache.get(host);
}

function siteIcon(entry) {
  const icon = document.createElement("span");
  icon.className = "site-favicon";
  icon.setAttribute("aria-hidden", "true");

  const fallback = document.createElement("span");
  fallback.className = "site-favicon-fallback";
  const firstCharacter = entry.host
    .replace(/^www\./, "")
    .charAt(0)
    .toUpperCase();
  fallback.textContent = /^[A-Z0-9]$/.test(firstCharacter)
    ? firstCharacter
    : "•";
  icon.append(fallback);

  if (entry.permissionState !== "active") {
    return icon;
  }

  const image = document.createElement("img");
  image.alt = "";
  image.decoding = "async";
  image.loading = "lazy";
  image.hidden = true;
  icon.append(image);

  faviconUrl(entry.host).then((url) => {
    if (!url || !icon.isConnected) {
      return;
    }
    image.addEventListener(
      "load",
      () => {
        if (!icon.isConnected) {
          return;
        }
        image.hidden = false;
        fallback.hidden = true;
      },
      { once: true }
    );
    image.addEventListener(
      "error",
      () => {
        image.hidden = true;
        fallback.hidden = false;
      },
      { once: true }
    );
    image.src = url;
  });

  return icon;
}

function renderEntries() {
  siteList.replaceChildren();
  siteCount.textContent = String(entries.length);
  loadingState.hidden = true;
  emptyState.hidden = entries.length !== 0;
  const query = siteSearchInput.value.trim().toLowerCase();
  const visibleEntries = query
    ? entries.filter((entry) => entry.pattern.toLowerCase().includes(query))
    : entries;
  noResultsState.hidden = entries.length === 0 || visibleEntries.length > 0;
  siteTableWrap.hidden = visibleEntries.length === 0;

  for (const entry of visibleEntries) {
    const item = document.createElement("tr");
    item.className = "site-item";
    item.dataset.id = entry.id;

    const siteCell = document.createElement("td");
    siteCell.className = "site-cell";
    siteCell.dataset.label = "Site";
    const identity = document.createElement("div");
    identity.className = "site-identity";
    const pattern = document.createElement("strong");
    pattern.className = "site-pattern";
    pattern.textContent = entry.pattern;
    identity.append(siteIcon(entry), pattern);
    siteCell.append(identity);

    const scopeCell = document.createElement("td");
    scopeCell.dataset.label = "Portée";
    scopeCell.append(
      badge(
        entry.includeSubdomains
          ? "Domaine + sous-domaines"
          : "Domaine uniquement"
      )
    );

    const typeCell = document.createElement("td");
    typeCell.dataset.label = "Type de code";
    typeCell.append(badge(passwordTypeLabel(entry.passwordType)));

    const statusCell = document.createElement("td");
    statusCell.dataset.label = "Statut";
    statusCell.append(permissionBadge(entry));

    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-cell";
    actionsCell.dataset.label = "Actions";
    const actions = document.createElement("div");
    actions.className = "site-actions";
    if (entry.permissionState !== "active") {
      const activate = actionButton("Activer", "activate");
      activate.classList.add("activate-button");
      activate.ariaLabel = `Activer ${entry.pattern} sur cet appareil`;
      actions.append(activate);
    }
    actions.append(
      actionButton("Modifier", "edit"),
      actionButton("Supprimer", "delete", "icon-button-danger")
    );
    actions.querySelector('[data-action="edit"]').ariaLabel =
      `Modifier ${entry.pattern}`;
    actions.querySelector('[data-action="delete"]').ariaLabel =
      `Supprimer ${entry.pattern}`;
    actionsCell.append(actions);

    item.append(siteCell, scopeCell, typeCell, statusCell, actionsCell);
    siteList.append(item);
  }

  const inactive = entries.filter(
    (entry) => entry.permissionState !== "active"
  );
  activationBanner.hidden = inactive.length === 0;
  if (inactive.length > 0) {
    activationText.textContent =
      `${inactive.length} site${inactive.length > 1 ? "s synchronisés nécessitent" : " synchronisé nécessite"} votre autorisation locale.`;
    activateAllButton.textContent =
      `Autoriser ${inactive.length} site${inactive.length > 1 ? "s" : ""}`;
  }
}

window.addEventListener("pagehide", () => {
  for (const url of faviconObjectUrls) {
    URL.revokeObjectURL(url);
  }
  faviconObjectUrls.clear();
});

function plural(value, singular, pluralForm = `${singular}s`) {
  return value === 1 ? singular : pluralForm;
}

function renderStats() {
  const active = entries.filter(
    (entry) => entry.permissionState === "active"
  ).length;
  const missing = entries.filter(
    (entry) => entry.permissionState !== "active"
  ).length;
  const failures = history.filter(
    (item) => item.outcome === "failure"
  ).length;

  totalSitesStat.textContent = String(entries.length);
  totalSitesDetail.textContent =
    entries.length === 0
      ? "Aucune règle"
      : `${active} ${plural(active, "actif", "actifs")}`;
  activeSitesStat.textContent = String(active);
  activeSitesDetail.textContent =
    active === entries.length && entries.length > 0
      ? "Toutes les règles sont actives"
      : active === 0
        ? "Aucun accès accordé"
        : `${entries.length - active} à finaliser`;
  unlockedTabsStat.textContent = String(unlockedTabs);
  unlockedTabsDetail.textContent =
    unlockedTabs === 0
      ? "Tout est verrouillé"
      : `${unlockedTabs} ${plural(unlockedTabs, "onglet ouvert", "onglets ouverts")}`;
  missingPermissionsStat.textContent = String(missing);
  missingPermissionsDetail.textContent =
    missing === 0
      ? "Aucune action requise"
      : `${missing} ${plural(missing, "autorisation", "autorisations")}`;
  failedAttemptsStat.textContent = String(failures);
  failedAttemptsDetail.textContent =
    failures === 0
      ? "Aucun échec enregistré"
      : `Parmi les ${history.length} dernières tentatives`;
}

function relativeTime(timestamp) {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) {
    return "à l’instant";
  }
  if (minutes < 60) {
    return `il y a ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `il y a ${hours} h`;
  }
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function renderHistory() {
  historyList.replaceChildren();
  historyEmptyState.hidden = history.length > 0;
  clearHistoryButton.hidden = history.length === 0;

  for (const item of history) {
    const row = document.createElement("li");
    row.className = "history-item";

    const dot = document.createElement("span");
    dot.className =
      item.outcome === "success"
        ? "history-dot"
        : "history-dot history-dot-failure";
    dot.setAttribute("aria-hidden", "true");

    const site = document.createElement("div");
    site.className = "history-site";
    const hostname = document.createElement("strong");
    hostname.textContent = item.hostname;
    const details = document.createElement("small");
    details.textContent =
      `${item.pattern} · ${passwordTypeLabel(item.passwordType)}`;
    site.append(hostname, details);

    const meta = document.createElement("div");
    meta.className = "history-meta";
    const outcome = document.createElement("span");
    outcome.className =
      item.outcome === "success"
        ? "history-outcome history-success"
        : "history-outcome history-failure";
    outcome.textContent =
      item.outcome === "success" ? "Déverrouillé" : "Échec";
    const time = document.createElement("time");
    time.className = "history-time";
    time.dateTime = new Date(item.occurredAt).toISOString();
    time.title = new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "full",
      timeStyle: "medium",
    }).format(item.occurredAt);
    time.textContent = relativeTime(item.occurredAt);
    meta.append(outcome, time);

    row.append(dot, site, meta);
    historyList.append(row);
  }
}

function formatDiagnostics(diagnostics) {
  return JSON.stringify(
    {
      report: "SiteLock diagnostic",
      copiedAt: new Date().toISOString(),
      browser: navigator.userAgent,
      platform: navigator.platform,
      diagnostics,
    },
    null,
    2
  );
}

async function loadDiagnostics() {
  diagnosticsOutput.textContent = "Chargement du diagnostic…";
  const response = await chrome.runtime.sendMessage({
    type: "settings.getDiagnostics",
  });
  if (!response?.ok) {
    throw new Error(response?.reason);
  }
  const text = formatDiagnostics(response.diagnostics ?? {});
  diagnosticsOutput.textContent = text;
  return text;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.append(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    if (!copied) {
      throw new Error("copy_failed");
    }
  }
}

async function loadEntries() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "settings.list",
    });
    if (!response?.ok) {
      throw new Error(response?.reason);
    }
    entries = response.entries;
    history = response.history ?? [];
    unlockedTabs = response.unlockedTabs ?? 0;
    maxEntries = response.maxEntries ?? 100;
    renderEntries();
    renderStats();
    renderHistory();

    if (!welcomeBanner.hidden && entries.length > 0) {
      welcomeBanner.querySelector("strong").textContent =
        "Vos réglages ont été retrouvés";
      welcomeBanner.querySelector("p").textContent =
        "Activez les domaines nécessaires sur cet appareil pour terminer.";
    }
  } catch (error) {
    if (error?.message === "master_required") {
      showMasterGate("unlock");
      return;
    }
    console.error("Impossible de charger les réglages SiteLock.", error);
    loadingState.innerHTML = "";
    const message = document.createElement("p");
    message.textContent = "Impossible de charger les réglages. Actualisez la page.";
    loadingState.append(message);
  }
}

async function requestEntryPermission(entry) {
  try {
    return await chrome.permissions.request({
      origins: [permissionOrigin(entry)],
    });
  } catch (error) {
    console.error("Impossible de demander l’autorisation du site.", error);
    return false;
  }
}

function validatePasswordFields() {
  if (selectedValue("passwordType") !== "custom") {
    return null;
  }

  const existing = entries.find((entry) => entry.id === editingId);
  const preservingExisting =
    existing?.passwordType === "custom" &&
    passwordInput.value === "" &&
    passwordConfirmInput.value === "";
  if (preservingExisting) {
    return null;
  }
  if (passwordInput.value.length < 8) {
    return "Utilisez au moins 8 caractères.";
  }
  if (passwordInput.value !== passwordConfirmInput.value) {
    return "Les mots de passe ne correspondent pas.";
  }
  return null;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormStatus("");

  let candidate;
  try {
    candidate = currentSiteCandidate();
  } catch (error) {
    const reason =
      error instanceof DomainInputError ? error.code : "invalid_site";
    setFormStatus(ERROR_MESSAGES[reason] ?? ERROR_MESSAGES.invalid_site, "error");
    siteInput.focus();
    return;
  }

  const passwordError = validatePasswordFields();
  if (passwordError) {
    setFormStatus(passwordError, "error");
    passwordInput.focus();
    return;
  }
  const duplicate = entries.find(
    (entry) =>
      entry.id !== editingId &&
      entry.host === candidate.host &&
      entry.includeSubdomains === candidate.includeSubdomains
  );
  if (duplicate) {
    setFormStatus(ERROR_MESSAGES.duplicate, "error");
    return;
  }
  if (!editingId && entries.length >= maxEntries) {
    setFormStatus(ERROR_MESSAGES.entry_limit, "error");
    return;
  }

  const payload = {
    type: "settings.save",
    id: editingId,
    rawSite: siteInput.value,
    includeSubdomains: candidate.includeSubdomains,
    passwordType: selectedValue("passwordType"),
    password: passwordInput.value,
  };
  const requestedOrigin = permissionOrigin(candidate);
  const permissionAlreadyGrantedPromise = chrome.permissions
    .contains({
      origins: [requestedOrigin],
    })
    .catch(() => false);
  const permissionRequestPromise = requestEntryPermission(candidate);
  setSaving(true);
  const [permissionAlreadyGranted, permissionGranted] = await Promise.all([
    permissionAlreadyGrantedPromise,
    permissionRequestPromise,
  ]);
  try {
    const response = await chrome.runtime.sendMessage(payload);
    if (!response?.ok) {
      if (!permissionAlreadyGranted && permissionGranted) {
        await chrome.permissions.remove({ origins: [requestedOrigin] });
      }
      const message = ERROR_MESSAGES[response?.reason] ?? ERROR_MESSAGES.internal_error;
      setFormStatus(message, "error");
      return;
    }

    const activeOnDevice = response.entry.permissionState === "active";

    const successMessage = activeOnDevice
      ? "Protection enregistrée et active sur cet appareil."
      : "Protection synchronisée. Autorisez le site pour l’activer ici.";
    resetForm();
    await loadEntries();
    showToast(successMessage);
  } catch (error) {
    console.error("Impossible d’enregistrer le site.", error);
    if (!permissionAlreadyGranted && permissionGranted) {
      await chrome.permissions
        .remove({ origins: [requestedOrigin] })
        .catch(() => undefined);
    }
    setFormStatus(ERROR_MESSAGES.internal_error, "error");
  } finally {
    setSaving(false);
  }
});

siteInput.addEventListener("input", updatePreview);
form.addEventListener("change", (event) => {
  if (event.target.name === "scope") {
    updatePreview();
  }
  if (event.target.name === "passwordType") {
    updatePasswordFields();
  }
});

cancelEditButton.addEventListener("click", resetForm);

function scrollToSiteForm(focusTarget = siteInput) {
  const topbarHeight = dashboardTopbar?.getBoundingClientRect().height ?? 0;
  const targetTop =
    addSitePanel.getBoundingClientRect().top +
    window.scrollY -
    topbarHeight -
    16;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
  window.scrollTo({
    top: Math.max(0, targetTop),
    behavior: reduceMotion ? "auto" : "smooth",
  });
  window.requestAnimationFrame(() => {
    focusTarget.focus({ preventScroll: true });
  });
}

function beginEditing(entry) {
  editingId = entry.id;
  siteInput.value = entry.host;
  setSelectedValue(
    "scope",
    entry.includeSubdomains ? "subdomains" : "exact"
  );
  setSelectedValue("passwordType", entry.passwordType);
  passwordInput.value = "";
  passwordConfirmInput.value = "";
  formTitle.textContent = "Modifier la protection";
  saveButton.textContent = submitButtonLabel();
  cancelEditButton.hidden = false;
  setFormStatus(
    entry.passwordType === "custom"
      ? "Laissez les champs de mot de passe vides pour conserver le mot de passe actuel."
      : "Choisissez le nouveau type de code puis enregistrez."
  );
  updatePasswordFields();
  applyFormMode();
  updatePreview();
  scrollToSiteForm(
    form.querySelector('input[name="passwordType"]:checked')
  );
}

siteList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  const item = event.target.closest(".site-item");
  if (!button || !item) {
    return;
  }
  const entry = entries.find((candidate) => candidate.id === item.dataset.id);
  if (!entry) {
    return;
  }

  if (button.dataset.action === "edit") {
    beginEditing(entry);
    return;
  }
  if (button.dataset.action === "delete") {
    pendingDeleteId = entry.id;
    deletePattern.textContent = entry.pattern;
    deleteDialog.returnValue = "";
    deleteDialog.showModal();
    deleteDialog.querySelector('[value="cancel"]').focus();
    return;
  }
  if (button.dataset.action === "activate") {
    button.disabled = true;
    try {
      const granted = await requestEntryPermission(entry);
      if (granted) {
        await chrome.runtime.sendMessage({ type: "settings.rebuild" });
        showToast("SiteLock est maintenant actif pour ce site.");
      } else {
        showToast("Autorisation refusée. Le réglage reste synchronisé.");
      }
      await loadEntries();
    } catch (error) {
      console.error("Impossible d’activer le site.", error);
      showToast("L’autorisation a échoué. Réessayez.");
      button.disabled = false;
    }
  }
});

deleteDialog.addEventListener("close", async () => {
  if (deleteDialog.returnValue !== "confirm" || !pendingDeleteId) {
    pendingDeleteId = null;
    return;
  }
  const id = pendingDeleteId;
  pendingDeleteId = null;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "settings.delete",
      id,
    });
    if (!response?.ok) {
      throw new Error(response?.reason);
    }
    if (editingId === id) {
      resetForm();
    }
    await loadEntries();
    showToast("Protection supprimée.");
  } catch (error) {
    console.error("Impossible de supprimer le réglage.", error);
    showToast("La suppression a échoué. Réessayez.");
  }
});

activateAllButton.addEventListener("click", async () => {
  const origins = [
    ...new Set(
      entries
        .filter((entry) => entry.permissionState !== "active")
        .map(permissionOrigin)
    ),
  ];
  if (origins.length === 0) {
    return;
  }

  activateAllButton.disabled = true;
  try {
    const granted = await chrome.permissions.request({ origins });
    if (granted) {
      await chrome.runtime.sendMessage({ type: "settings.rebuild" });
      showToast("Les sites synchronisés sont maintenant actifs.");
    } else {
      showToast("Autorisation refusée. Vous pourrez réessayer plus tard.");
    }
    await loadEntries();
  } catch (error) {
    console.error("Impossible d’activer les sites synchronisés.", error);
    showToast("L’autorisation a échoué. Réessayez.");
  } finally {
    activateAllButton.disabled = false;
  }
});

siteSearchInput.addEventListener("input", renderEntries);

clearHistoryButton.addEventListener("click", async () => {
  clearHistoryButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "settings.clearHistory",
    });
    if (!response?.ok) {
      throw new Error(response?.reason);
    }
    history = [];
    renderHistory();
    renderStats();
    showToast("Historique local effacé.");
  } catch (error) {
    console.error("Impossible d’effacer l’historique.", error);
    showToast("Impossible d’effacer l’historique.");
  } finally {
    clearHistoryButton.disabled = false;
  }
});

diagnosticsDetails.addEventListener("toggle", () => {
  if (!diagnosticsDetails.open) {
    return;
  }
  loadDiagnostics().catch((error) => {
    console.error("Impossible de charger le diagnostic.", error);
    diagnosticsOutput.textContent =
      "Impossible de charger le diagnostic. Réessayez.";
  });
});

refreshDiagnosticsButton.addEventListener("click", async () => {
  refreshDiagnosticsButton.disabled = true;
  try {
    await loadDiagnostics();
  } catch (error) {
    console.error("Impossible d’actualiser le diagnostic.", error);
    diagnosticsOutput.textContent =
      "Impossible d’actualiser le diagnostic. Réessayez.";
  } finally {
    refreshDiagnosticsButton.disabled = false;
  }
});

copyDiagnosticsButton.addEventListener("click", async () => {
  copyDiagnosticsButton.disabled = true;
  try {
    const text = await loadDiagnostics();
    await copyText(text);
    showToast("Diagnostic copié. Vous pouvez maintenant nous l’envoyer.");
  } catch (error) {
    console.error("Impossible de copier le diagnostic.", error);
    diagnosticsDetails.open = true;
    showToast("La copie a échoué. Le diagnostic est affiché ci-dessous.");
  } finally {
    copyDiagnosticsButton.disabled = false;
  }
});

clearDiagnosticsButton.addEventListener("click", async () => {
  clearDiagnosticsButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "settings.clearDiagnostics",
    });
    if (!response?.ok) {
      throw new Error(response?.reason);
    }
    diagnosticsOutput.textContent =
      "Journal effacé. Reproduisez maintenant le problème, puis actualisez.";
    showToast("Journal de diagnostic effacé.");
  } catch (error) {
    console.error("Impossible d’effacer le diagnostic.", error);
    showToast("Impossible d’effacer le diagnostic.");
  } finally {
    clearDiagnosticsButton.disabled = false;
  }
});

lockOptionsButton.addEventListener("click", async () => {
  lockOptionsButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "settings.masterLock",
    });
    if (!response?.ok) {
      throw new Error(response?.reason);
    }
    window.location.reload();
  } catch (error) {
    console.error("Impossible de verrouiller les réglages.", error);
    showToast("Le verrouillage des réglages a échoué.");
    lockOptionsButton.disabled = false;
  }
});

function setChangeMasterStatus(message, type = "") {
  changeMasterStatus.textContent = message;
  changeMasterStatus.dataset.type = type;
}

changeMasterButton.addEventListener("click", () => {
  changeMasterForm.reset();
  setChangeMasterStatus("");
  changeMasterDialog.showModal();
  currentMasterInput.focus();
});

cancelMasterChangeButton.addEventListener("click", () => {
  changeMasterDialog.close();
});

changeMasterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setChangeMasterStatus("");

  if (newMasterInput.value.length < 8) {
    setChangeMasterStatus("Utilisez au moins 8 caractères.", "error");
    newMasterInput.focus();
    return;
  }
  if (newMasterInput.value !== newMasterConfirmInput.value) {
    setChangeMasterStatus("Les mots de passe ne correspondent pas.", "error");
    newMasterConfirmInput.focus();
    return;
  }

  saveMasterChangeButton.disabled = true;
  cancelMasterChangeButton.disabled = true;
  masterMutationInFlight = true;
  suppressMasterVerifierReloadUntil = Date.now() + 2_000;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "settings.masterChange",
      currentPassword: currentMasterInput.value,
      newPassword: newMasterInput.value,
    });
    if (!response?.ok) {
      const message =
        response?.reason === "rate_limited" &&
        Number.isInteger(response.retryAfterSeconds)
          ? `Trop de tentatives. Réessayez dans ${response.retryAfterSeconds} secondes.`
          : ERROR_MESSAGES[response?.reason] ?? ERROR_MESSAGES.internal_error;
      setChangeMasterStatus(message, "error");
      currentMasterInput.value = "";
      currentMasterInput.focus();
      return;
    }
    changeMasterDialog.close();
    changeMasterForm.reset();
    showToast("Mot de passe maître mis à jour.");
  } catch (error) {
    console.error("Impossible de changer le mot de passe maître.", error);
    setChangeMasterStatus(ERROR_MESSAGES.internal_error, "error");
  } finally {
    masterMutationInFlight = false;
    saveMasterChangeButton.disabled = false;
    cancelMasterChangeButton.disabled = false;
  }
});

lockAllButton.addEventListener("click", async () => {
  lockAllButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "settings.lockAll",
    });
    if (!response?.ok) {
      throw new Error(response?.reason);
    }
    showToast("Tous les onglets sont reverrouillés.");
  } catch (error) {
    console.error("Impossible de reverrouiller les onglets.", error);
    showToast("Le reverrouillage a échoué.");
  } finally {
    lockAllButton.disabled = false;
  }
});

function scheduleReload() {
  if (!dashboardInitialized) {
    return;
  }
  window.clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(loadEntries, 120);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "session" &&
    Object.hasOwn(changes, "sitelock.masterUnlocked")
  ) {
    chrome.runtime
      .sendMessage({ type: "settings.masterStatus" })
      .then((response) => {
        if (response?.ok && !response.unlocked) {
          showMasterGate(response.configured ? "unlock" : "create");
        }
      })
      .catch((error) => {
        console.error("Impossible de vérifier l’accès aux réglages.", error);
        showMasterGate("unlock");
      });
    return;
  }
  if (
    areaName === "sync" &&
    Object.hasOwn(changes, "sitelock.masterVerifier")
  ) {
    if (
      masterMutationInFlight ||
      Date.now() < suppressMasterVerifierReloadUntil
    ) {
      return;
    }
    window.location.reload();
    return;
  }
  if (
    (
      areaName === "sync" &&
      Object.keys(changes).some((key) => key.startsWith("sitelock.site."))
    ) ||
    (
      areaName === "local" &&
      Object.hasOwn(changes, "sitelock.activityHistory")
    )
  ) {
    scheduleReload();
  }
});
chrome.permissions.onAdded.addListener(scheduleReload);
chrome.permissions.onRemoved.addListener(scheduleReload);

const query = new URLSearchParams(window.location.search);
welcomeBanner.hidden = !(query.has("welcome") || query.has("migrated"));
if (query.has("migrated")) {
  welcomeBanner.querySelector("strong").textContent = "Skellock devient SiteLock";
  welcomeBanner.querySelector("p").textContent =
    "Votre protection Skello a été conservée. Vous pouvez maintenant ajouter d’autres sites.";
}

initializeMasterProtection();
