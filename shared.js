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
  const THEME_STORAGE_KEY = "folkevalget-theme";
  let catalogueDataPromise = null;

  const siteBasePath = detectSiteBasePath();
  initThemeToggle();
  initNavigation();
  initGlobalSiteStats();

  async function loadCatalogueData() {
    if (catalogueDataPromise) {
      return catalogueDataPromise;
    }

    const bootstrapProfiles = Array.isArray(readBootstrapPayload()?.profiles)
      ? readBootstrapPayload().profiles
      : null;
    const bootstrapStats = readBootstrapPayload()?.stats ?? null;

    catalogueDataPromise = (async () => {
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
    })().catch((error) => {
      catalogueDataPromise = null;
      throw error;
    });

    return catalogueDataPromise;
  }

  async function loadVoteData() {
    const bootstrapVotes = Array.isArray(window.__FOLKEVALGET_VOTES__?.votes)
      ? window.__FOLKEVALGET_VOTES__.votes
      : null;

    if (bootstrapVotes) {
      return bootstrapVotes;
    }

    return fetchJson("data/afstemninger.json");
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
    const name = partyName || (partyShort ? PARTY_NAMES[partyShort] : null);
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

  function buildVoteUrl(voteId) {
    if (!voteId) {
      return toSiteUrl("afstemninger.html");
    }
    return `${toSiteUrl("afstemninger.html")}?id=${encodeURIComponent(voteId)}`;
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
    if (profile?.seniority_tag === "newcomer") {
      flags.push({ key: "newcomer", label: "Ny" });
    }
    if (isNorthAtlanticMandate(profile)) {
      flags.push({ key: "north-atlantic", label: "Nordatlantisk" });
    }
    return flags.slice(0, 2);
  }

  function profileContextNotes(profile) {
    const notes = [];
    if (isCurrentMinister(profile)) {
      notes.push(
        "Ministre deltager sjældnere i afstemninger, fordi de varetager ministerarbejde og ikke altid er til stede i salen."
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

  function initNavigation() {
    const toggle = document.querySelector("[data-nav-toggle]");
    const nav = document.querySelector("[data-site-nav]");
    if (!toggle || !nav) {
      return;
    }

    const closeMenu = () => {
      toggle.setAttribute("aria-expanded", "false");
      nav.dataset.open = "false";
    };

    toggle.addEventListener("click", () => {
      const isOpen = nav.dataset.open === "true";
      nav.dataset.open = String(!isOpen);
      toggle.setAttribute("aria-expanded", String(!isOpen));
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMenu);
    });

    const mediaQuery = window.matchMedia("(min-width: 641px)");
    const syncForViewport = () => {
      if (mediaQuery.matches) {
        closeMenu();
      }
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncForViewport);
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(syncForViewport);
    }

    syncForViewport();
  }

  function initThemeToggle() {
    const headerMeta = document.querySelector(".site-header-meta");
    const stats = document.querySelector("[data-site-stats]");
    if (!headerMeta || !stats) {
      return;
    }

    const tools = document.createElement("div");
    tools.className = "site-header-tools";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "theme-toggle";
    toggle.innerHTML = '<span class="theme-toggle-icon" aria-hidden="true"></span><span class="sr-only"></span>';

    const storedTheme = readStoredTheme();
    if (storedTheme === "dark") {
      applyTheme("dark");
    }

    updateThemeToggle(toggle);

    toggle.addEventListener("click", () => {
      const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
      updateThemeToggle(toggle);
    });

    stats.parentNode.insertBefore(tools, stats);
    tools.append(toggle, stats);
  }

  function initGlobalSiteStats() {
    const statsRoot = document.querySelector("[data-site-stats]");
    if (!statsRoot) {
      return;
    }

    loadCatalogueData()
      .then(({ stats }) => {
        renderStats(statsRoot, stats);
      })
      .catch((error) => {
        console.error(error);
      });
  }

  function readStoredTheme() {
    try {
      return window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function applyTheme(theme) {
    if (theme === "dark") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {}
  }

  function syncThemeToggle(toggle) {
    const isDark = document.documentElement.dataset.theme === "dark";
    toggle.setAttribute("aria-pressed", String(isDark));
    toggle.textContent = isDark ? "Lys visning" : "Mørk visning";
  }

  function updateThemeToggle(toggle) {
    const isDark = document.documentElement.dataset.theme === "dark";
    const label = isDark ? "Skift til lys visning" : "Skift til mørk visning";
    toggle.setAttribute("aria-pressed", String(isDark));
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
    toggle.dataset.theme = isDark ? "dark" : "light";

    const srLabel = toggle.querySelector(".sr-only");
    if (srLabel) {
      srLabel.textContent = label;
    }
  }

  return {
    PARTY_NAMES,
    applyPhoto,
    buildCommitteeUrl,
    buildProfileUrl,
    buildVoteUrl,
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
    loadVoteData,
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
