(function initializeSiteLockDomains(globalScope) {
  "use strict";

  const MAX_INPUT_LENGTH = 2048;
  const MAX_HOST_LENGTH = 253;
  const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

  class DomainInputError extends Error {
    constructor(code) {
      super(code);
      this.name = "DomainInputError";
      this.code = code;
    }
  }

  function isIpv4(host) {
    const parts = host.split(".");
    return (
      parts.length === 4 &&
      parts.every(
        (part) =>
          /^\d{1,3}$/.test(part) &&
          Number(part) >= 0 &&
          Number(part) <= 255
      )
    );
  }

  function isIpv6(host) {
    return host.startsWith("[") && host.endsWith("]") && host.includes(":");
  }

  function isIpAddress(host) {
    return isIpv4(host) || isIpv6(host);
  }

  function isValidHostname(host) {
    if (
      typeof host !== "string" ||
      host.length === 0 ||
      host.length > MAX_HOST_LENGTH
    ) {
      return false;
    }

    if (host === "localhost" || isIpAddress(host)) {
      return true;
    }

    return host
      .split(".")
      .every((label) => DOMAIN_LABEL_PATTERN.test(label));
  }

  function normalizeHostname(hostname) {
    if (typeof hostname !== "string") {
      throw new DomainInputError("invalid_site");
    }

    const normalized = hostname.toLowerCase().replace(/\.$/, "");
    if (!isValidHostname(normalized)) {
      throw new DomainInputError("invalid_site");
    }
    return normalized;
  }

  function parseUserInput(rawInput) {
    if (typeof rawInput !== "string") {
      throw new DomainInputError("invalid_site");
    }

    let value = rawInput.trim();
    if (!value || value.length > MAX_INPUT_LENGTH || /[\u0000-\u001f]/.test(value)) {
      throw new DomainInputError("invalid_site");
    }

    let includeSubdomains = false;
    const wildcardMatch = value.match(/^(https?:\/\/)?\*\.(.+)$/i);
    if (wildcardMatch) {
      includeSubdomains = true;
      value = `${wildcardMatch[1] ?? ""}${wildcardMatch[2]}`;
    } else if (value.includes("*")) {
      throw new DomainInputError("wildcard_position");
    }

    const schemeMatch = value.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (
      schemeMatch &&
      schemeMatch[1].toLowerCase() !== "http" &&
      schemeMatch[1].toLowerCase() !== "https"
    ) {
      throw new DomainInputError("unsupported_scheme");
    }

    const candidate = schemeMatch ? value : `https://${value}`;
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new DomainInputError("invalid_site");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new DomainInputError("unsupported_scheme");
    }
    if (parsed.username || parsed.password) {
      throw new DomainInputError("credentials_not_allowed");
    }

    const host = normalizeHostname(parsed.hostname);
    if (
      includeSubdomains &&
      (host === "localhost" || isIpAddress(host) || !host.includes("."))
    ) {
      throw new DomainInputError("invalid_wildcard");
    }

    return Object.freeze({ host, includeSubdomains });
  }

  function formatPattern(entry) {
    return `${entry.includeSubdomains ? "*." : ""}${entry.host}`;
  }

  function permissionOrigin(entry) {
    return `*://${formatPattern(entry)}/*`;
  }

  function permissionOriginForScheme(entry, scheme) {
    if (scheme !== "http" && scheme !== "https") {
      throw new TypeError("Unsupported scheme");
    }
    return `${scheme}://${formatPattern(entry)}/*`;
  }

  function entryMatchesHostname(entry, hostname) {
    const normalized = normalizeHostname(hostname);
    return entry.includeSubdomains
      ? normalized === entry.host || normalized.endsWith(`.${entry.host}`)
      : normalized === entry.host;
  }

  function rulePriority(entry) {
    const labelCount = isIpv6(entry.host) ? 1 : entry.host.split(".").length;
    return 1000 + labelCount * 2 + (entry.includeSubdomains ? 0 : 1);
  }

  function findBestMatch(entries, hostname) {
    return (
      entries
        .filter((entry) => entryMatchesHostname(entry, hostname))
        .sort((left, right) => {
          const priorityDifference =
            rulePriority(right) - rulePriority(left);
          return priorityDifference || left.id.localeCompare(right.id);
        })[0] ?? null
    );
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function urlRegex(entry) {
    const escapedHost = escapeRegex(entry.host);
    const hostExpression = entry.includeSubdomains
      ? `(?:[^./:]+\\.)*${escapedHost}`
      : escapedHost;

    return `^https?://(?:[^/]*@)?${hostExpression}(?::[0-9]+)?(?:[/?].*)?$`;
  }

  globalScope.SiteLockDomains = Object.freeze({
    DomainInputError,
    entryMatchesHostname,
    findBestMatch,
    formatPattern,
    isIpAddress,
    isValidHostname,
    normalizeHostname,
    parseUserInput,
    permissionOrigin,
    permissionOriginForScheme,
    rulePriority,
    urlRegex,
  });
})(globalThis);
