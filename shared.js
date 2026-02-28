window.Folkevalget = (() => {
  const PARTY_NAMES = {
    S: "Socialdemokratiet",
    V: "Venstre",
    M: "Moderaterne",
    SF: "Socialistisk Folkeparti",
    EL: "Enhedslisten",
    KF: "Det Konservative Folkeparti",
    LA: "Liberal Alliance",
    RV: "Radikale Venstre",
    ALT: "Alternativet",
    DD: "Danmarksdemokraterne",
    DF: "Dansk Folkeparti",
    BP: "Borgernes Parti",
    IA: "Inuit Ataqatigiit",
    JF: "Javnaðarflokkurin",
    N: "Naleraq",
    SP: "Sambandsflokkurin",
    SIU: "Siumut",
    UFG: "Uden for grupperne",
  };
  const NORTH_ATLANTIC_PARTIES = new Set(["IA", "JF", "SP", "SIU", "N"]);

  const SAG_TYPES = {
    L: "lovforslag",
    B: "beslutningsforslag",
    V: "vedtagelse",
  };

  const siteBasePath = detectSiteBasePath();

  async function loadCatalogueData() {
    const bootstrapProfiles = Array.isArray(readBootstrapPayload()?.profiles)
      ? readBootstrapPayload().profiles
      : null;
    const bootstrapStats = readBootstrapPayload()?.stats ?? null;

    const [profilesResult, statsResult] = await Promise.allSettled([
      bootstrapProfiles ? Promise.resolve(bootstrapProfiles) : fetchJson("data/profiler.json"),
      bootstrapStats ? Promise.resolve(bootstrapStats) : fetchJson("data/site_stats.json"),
    ]);

    if (profilesResult.status !== "fulfilled") {
      throw profilesResult.reason;
    }

    const profiles = profilesResult.value;
    const stats =
      statsResult.status === "fulfilled"
        ? statsResult.value
        : {
            generated_at: null,
            counts: {
              profiles: profiles.length,
              votes: 0,
            },
          };

    return { profiles, stats };
  }

  async function fetchJson(path) {
    const url = toSiteUrl(path);
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Failed to load ${path}: ${response.status}`);
        }
        return response.json();
      } catch (error) {
        lastError = error;
        if (attempt === 2) {
          break;
        }
        await wait(300 * (attempt + 1));
      }
    }

    throw lastError;
  }

  function detectSiteBasePath() {
    const { hostname, pathname } = window.location;
    if (!hostname.endsWith("github.io")) {
      return "/";
    }

    const segments = pathname.split("/").filter(Boolean);
    return segments.length === 0 ? "/" : `/${segments[0]}/`;
  }

  function toSiteUrl(path) {
    const normalizedPath = path.replace(/^\/+/, "");
    return `${siteBasePath}${normalizedPath}`;
  }

  function readBootstrapPayload() {
    const payload = window.__FOLKEVALGET_BOOTSTRAP__;
    return payload && typeof payload === "object" ? payload : null;
  }

  function wait(durationMs) {
    return new Promise((resolve) => window.setTimeout(resolve, durationMs));
  }

  function formatNumber(value) {
    if (value === null || value === undefined) {
      return "-";
    }
    return new Intl.NumberFormat("da-DK").format(value);
  }

  function formatPercent(value) {
    if (value === null || value === undefined) {
      return "-";
    }
    return `${String(value).replace(".", ",")} %`;
  }

  function formatDate(value) {
    if (!value) {
      return "-";
    }
    return new Intl.DateTimeFormat("da-DK", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  }

  function buildSagUrl(sagNumber, dateStr) {
    const match = (sagNumber || "").match(/^([A-Z]+)\s+(\d+)$/);
    if (!match) {
      return null;
    }
    const [, prefix, number] = match;
    const type = SAG_TYPES[prefix];
    if (!type) {
      return null;
    }
    const date = new Date(dateStr);
    const sessionYear = date.getMonth() >= 9 ? date.getFullYear() : date.getFullYear() - 1;
    return `https://www.folketingstidende.dk/samling/${sessionYear}1/${type}/${prefix}${number}/index.htm`;
  }

  function voteBadgeClass(label) {
    const normalized = (label || "").toLowerCase();
    if (normalized.includes("for")) {
      return "for";
    }
    if (normalized.includes("imod")) {
      return "imod";
    }
    if (normalized.includes("frav")) {
      return "fravaer";
    }
    return "hverken";
  }

  function partyDisplayName(partyName, partyShort) {
    const name = partyName || (partyShort && PARTY_NAMES[partyShort]) || null;
    if (name && partyShort) {
      return `${name} (${partyShort})`;
    }
    return name || partyShort || "Uden parti";
  }

  function committeeDisplayName(committee) {
    if (!committee) {
      return "Ukendt udvalg";
    }
    if (committee.short_name && committee.name) {
      return `${committee.short_name} · ${committee.name}`;
    }
    return committee.name || committee.short_name || "Ukendt udvalg";
  }

  function buildCommitteeUrl(shortName) {
    if (!shortName) {
      return null;
    }
    return `https://www.ft.dk/da/udvalg/udvalgene/${shortName.toLowerCase()}/`;
  }

  function getInitials(name) {
    return (name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase();
  }

  function resolvePhotoUrl(photoUrl) {
    if (!photoUrl) {
      return null;
    }
    if (photoUrl.startsWith("http://") || photoUrl.startsWith("https://")) {
      return photoUrl;
    }
    return toSiteUrl(photoUrl);
  }

  function photoCreditText(profile) {
    if (!profile) {
      return null;
    }
    if (profile.photo_credit_text) {
      return profile.photo_credit_text;
    }
    if (profile.photo_source_name && profile.photo_photographer) {
      return `${profile.photo_source_name} / Fotograf ${profile.photo_photographer}`;
    }
    return profile.photo_source_name || null;
  }

  function applyPhoto(image, fallback, photoUrl, name, attributionText = null) {
    const resolvedUrl = resolvePhotoUrl(photoUrl);
    if (!resolvedUrl) {
      image.classList.add("hidden");
      fallback.classList.remove("hidden");
      fallback.textContent = getInitials(name);
      return;
    }

    fallback.textContent = getInitials(name);
    image.src = resolvedUrl;
    image.alt = name || "";
    image.title = attributionText || "";
    image.classList.remove("hidden");
    fallback.classList.add("hidden");
    image.onerror = () => {
      image.classList.add("hidden");
      fallback.classList.remove("hidden");
    };
  }

  function metricTone(value, kind) {
    if (value === null || value === undefined) {
      return "neutral";
    }

    if (kind === "loyalty") {
      if (value >= 95) return "good";
      if (value >= 85) return "ok";
      if (value >= 70) return "warn";
      return "risk";
    }

    if (value >= 85) return "good";
    if (value >= 65) return "ok";
    if (value >= 40) return "warn";
    return "risk";
  }

  function clampPercent(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return 0;
    }
    return Math.max(0, Math.min(100, Number(value)));
  }

  function compareProfiles(left, right, sortMode) {
    if (sortMode === "attendance_desc") {
      return compareMetric(left.attendance_pct, right.attendance_pct, left, right, "desc");
    }
    if (sortMode === "attendance_asc") {
      return compareMetric(left.attendance_pct, right.attendance_pct, left, right, "asc");
    }
    if (sortMode === "loyalty_desc") {
      return compareMetric(left.party_loyalty_pct, right.party_loyalty_pct, left, right, "desc");
    }
    if (sortMode === "loyalty_asc") {
      return compareMetric(left.party_loyalty_pct, right.party_loyalty_pct, left, right, "asc");
    }
    return compareByName(left, right);
  }

  function compareMetric(leftValue, rightValue, leftProfile, rightProfile, direction) {
    const leftMissing = leftValue === null || leftValue === undefined;
    const rightMissing = rightValue === null || rightValue === undefined;

    if (leftMissing && rightMissing) {
      return compareByName(leftProfile, rightProfile);
    }
    if (leftMissing) {
      return 1;
    }
    if (rightMissing) {
      return -1;
    }

    const delta =
      direction === "desc" ? Number(rightValue) - Number(leftValue) : Number(leftValue) - Number(rightValue);

    return delta !== 0 ? delta : compareByName(leftProfile, rightProfile);
  }

  function compareByName(left, right) {
    return left.name.localeCompare(right.name, "da");
  }

  function normaliseText(value) {
    return (value || "")
      .toLowerCase()
      .replaceAll("æ", "ae")
      .replaceAll("ø", "oe")
      .replaceAll("å", "aa")
      .replaceAll("ð", "d")
      .replaceAll("þ", "th")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildProfileUrl(profileId) {
    return `${toSiteUrl("profil.html")}?id=${encodeURIComponent(profileId)}`;
  }

  function isNorthAtlanticMandate(profile) {
    return NORTH_ATLANTIC_PARTIES.has(profile?.party_short || "");
  }

  function isCurrentMinister(profile) {
    const role = (profile?.role || "").toLowerCase();
    return role.includes("minister") && !role.includes("fhv.");
  }

  function profileContextFlags(profile) {
    const flags = [];
    if (isCurrentMinister(profile)) {
      flags.push({ key: "minister", label: "Minister" });
    }
    if (isNorthAtlanticMandate(profile)) {
      flags.push({ key: "north-atlantic", label: "Nordatlantisk mandat" });
    }
    return flags;
  }

  function profileContextNotes(profile) {
    const notes = [];
    if (isCurrentMinister(profile)) {
      notes.push(
        "Ministre deltager ofte sjældnere i afstemninger, fordi de varetager ministerarbejde og ikke altid er til stede i salen."
      );
    }
    if (isNorthAtlanticMandate(profile)) {
      notes.push(
        "Medlemmer valgt i Færøerne og Grønland deltager ikke nødvendigvis i alle afstemninger, så fremmøde skal læses med ekstra kontekst."
      );
    }
    return notes;
  }

  function renderStats(root, stats) {
    if (!root || !stats) {
      return;
    }
    const profileNode = root.querySelector("[data-stat='profiles']");
    const voteNode = root.querySelector("[data-stat='votes']");
    const updatedNode = root.querySelector("[data-stat='updated']");
    if (profileNode) {
      profileNode.textContent = formatNumber(stats.counts?.profiles);
    }
    if (voteNode) {
      voteNode.textContent = formatNumber(stats.counts?.votes);
    }
    if (updatedNode) {
      updatedNode.textContent = formatDate(stats.generated_at);
    }
  }

  return {
    PARTY_NAMES,
    applyPhoto,
    buildCommitteeUrl,
    buildProfileUrl,
    buildSagUrl,
    clampPercent,
    committeeDisplayName,
    compareProfiles,
    fetchJson,
    formatDate,
    formatNumber,
    formatPercent,
    getInitials,
    isCurrentMinister,
    isNorthAtlanticMandate,
    loadCatalogueData,
    metricTone,
    normaliseText,
    partyDisplayName,
    photoCreditText,
    profileContextFlags,
    profileContextNotes,
    readBootstrapPayload,
    renderStats,
    resolvePhotoUrl,
    siteBasePath,
    toSiteUrl,
    voteBadgeClass,
  };
})();
