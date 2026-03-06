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
  const FAVORITES_STORAGE_KEY = "folkevalget-favorites-v1";
  const FAVORITES_EVENT_NAME = "folkevalget:favorites-changed";
  const GLOBAL_SEARCH_SECTION_ORDER = ["profile", "vote", "party", "constituency"];
  const GLOBAL_SEARCH_SECTION_LABELS = {
    profile: "Politikere",
    vote: "Afstemninger",
    party: "Partier",
    constituency: "Storkredse",
  };
  const GLOBAL_SEARCH_RESULT_LIMIT = 12;
  const GLOBAL_SEARCH_PER_SECTION = 4;
  let catalogueDataPromise = null;
  let voteDataPromise = null;
  let voteOverviewPromise = null;
  let voteDetailsPromise = null;
  let voteDetailsIndexPromise = null;
  const voteDetailIndexById = new Map();
  const voteDetailByIdCache = new Map();
  const voteDetailShardCache = new Map();
  const voteDetailShardPromises = new Map();
  let globalSearchIndexPromise = null;
  const globalSearchState = {
    open: false,
    query: "",
    activeIndex: -1,
    results: [],
    resultNodes: [],
    index: null,
    elements: null,
    previousFocus: null,
    isMac: /Mac|iPhone|iPad/i.test(window.navigator.platform || ""),
  };

  const siteBasePath = detectSiteBasePath();
  initHeaderParliamentMenu();
  initThemeToggle();
  initNavigation();
  initGlobalSiteStats();
  initGlobalSearch();
  initHeaderFavoritesLink();
  initFooterFavoritesLink();

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
      const currentProfileCount = countCurrentProfiles(profiles);
      const stats =
        statsResult.status === "fulfilled"
          ? {
              ...statsResult.value,
              counts: {
                ...statsResult.value.counts,
                profiles: currentProfileCount,
              },
            }
          : {
              generated_at: null,
              counts: {
                profiles: currentProfileCount,
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
    if (voteDataPromise) {
      return voteDataPromise;
    }

    voteDataPromise = (async () => {
      const bootstrapVotes = Array.isArray(window.__FOLKEVALGET_VOTES__?.votes)
        ? window.__FOLKEVALGET_VOTES__.votes
        : null;

      if (bootstrapVotes) {
        return bootstrapVotes;
      }

      const votes = await fetchJson("data/afstemninger.json");
      return Array.isArray(votes) ? votes : [];
    })().catch((error) => {
      voteDataPromise = null;
      throw error;
    });

    return voteDataPromise;
  }

  async function loadVoteOverview() {
    if (voteOverviewPromise) {
      return voteOverviewPromise;
    }

    voteOverviewPromise = (async () => {
      try {
        const overview = await fetchJson("data/afstemninger_overblik.json");
        if (Array.isArray(overview) && overview.length > 0) {
          return overview;
        }
      } catch (error) {}

      return loadVoteData();
    })().catch((error) => {
      voteOverviewPromise = null;
      throw error;
    });

    return voteOverviewPromise;
  }

  async function loadVoteDetails() {
    if (voteDetailsPromise) {
      return voteDetailsPromise;
    }

    voteDetailsPromise = (async () => {
      try {
        const details = await fetchJson("data/afstemninger_detaljer.json");
        if (Array.isArray(details) && details.length > 0) {
          for (const row of details) {
            const voteId = Number(row?.afstemning_id || 0);
            if (voteId > 0) {
              voteDetailByIdCache.set(voteId, row);
            }
          }
          return details;
        }
      } catch (error) {}

      const fullVotes = await loadVoteData();
      const fallbackDetails = (Array.isArray(fullVotes) ? fullVotes : []).map((vote) => ({
        afstemning_id: Number(vote.afstemning_id || 0),
        vote_groups: vote.vote_groups || {},
        vote_groups_by_party: vote.vote_groups_by_party || {},
        sag_resume: vote.sag_resume || null,
        konklusion: vote.konklusion || null,
        kommentar: vote.kommentar || null,
      }));
      for (const row of fallbackDetails) {
        const voteId = Number(row?.afstemning_id || 0);
        if (voteId > 0) {
          voteDetailByIdCache.set(voteId, row);
        }
      }
      return fallbackDetails;
    })().catch((error) => {
      voteDetailsPromise = null;
      throw error;
    });

    return voteDetailsPromise;
  }

  async function loadVoteDetailsIndex() {
    if (voteDetailIndexById.size > 0) {
      return voteDetailIndexById;
    }

    if (voteDetailsIndexPromise) {
      return voteDetailsIndexPromise;
    }

    voteDetailsIndexPromise = (async () => {
      try {
        const indexRows = await fetchJson("data/afstemninger_detaljer_index.json");
        if (Array.isArray(indexRows) && indexRows.length > 0) {
          for (const row of indexRows) {
            const voteId = Number(row?.afstemning_id || 0);
            const shard = String(row?.shard || "");
            if (voteId > 0 && shard) {
              voteDetailIndexById.set(voteId, shard);
            }
          }
          if (voteDetailIndexById.size > 0) {
            return voteDetailIndexById;
          }
        }
      } catch (error) {}

      const details = await loadVoteDetails();
      for (const row of details) {
        const voteId = Number(row?.afstemning_id || 0);
        if (voteId > 0) {
          voteDetailIndexById.set(voteId, "__full__");
        }
      }
      return voteDetailIndexById;
    })().catch((error) => {
      voteDetailsIndexPromise = null;
      throw error;
    });

    return voteDetailsIndexPromise;
  }

  async function loadVoteDetailsShard(shardKey) {
    const normalizedShard = String(shardKey || "").trim();
    if (!normalizedShard) {
      return [];
    }

    if (voteDetailShardCache.has(normalizedShard)) {
      return voteDetailShardCache.get(normalizedShard);
    }

    if (voteDetailShardPromises.has(normalizedShard)) {
      return voteDetailShardPromises.get(normalizedShard);
    }

    const shardPromise = fetchJson(`data/afstemninger_detaljer_shards/${encodeURIComponent(normalizedShard)}.json`)
      .then((rows) => {
        const shardRows = Array.isArray(rows) ? rows : [];
        voteDetailShardCache.set(normalizedShard, shardRows);
        for (const row of shardRows) {
          const voteId = Number(row?.afstemning_id || 0);
          if (voteId > 0) {
            voteDetailByIdCache.set(voteId, row);
          }
        }
        voteDetailShardPromises.delete(normalizedShard);
        return shardRows;
      })
      .catch((error) => {
        voteDetailShardPromises.delete(normalizedShard);
        throw error;
      });

    voteDetailShardPromises.set(normalizedShard, shardPromise);
    return shardPromise;
  }

  async function loadVoteDetailById(voteId) {
    const normalizedId = Number(voteId || 0);
    if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
      return null;
    }

    if (voteDetailByIdCache.has(normalizedId)) {
      return voteDetailByIdCache.get(normalizedId);
    }

    try {
      const index = await loadVoteDetailsIndex();
      const shard = String(index.get(normalizedId) || "");
      if (shard === "__full__") {
        const details = await loadVoteDetails();
        const match = details.find((row) => Number(row?.afstemning_id || 0) === normalizedId) || null;
        if (match) {
          voteDetailByIdCache.set(normalizedId, match);
        }
        return match;
      }
      if (shard) {
        await loadVoteDetailsShard(shard);
        return voteDetailByIdCache.get(normalizedId) || null;
      }
    } catch (error) {}

    const details = await loadVoteDetails();
    const match = details.find((row) => Number(row?.afstemning_id || 0) === normalizedId) || null;
    if (match) {
      voteDetailByIdCache.set(normalizedId, match);
    }
    return match;
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
    const normalizedNumber = String(sagNumber || "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
    const match = normalizedNumber.match(/^([A-ZÆØÅ]+)\s+(\d+)\s*([A-Z]?)$/u);
    if (!match) {
      return null;
    }

    const [, prefix, number, suffix] = match;
    const type = SAG_TYPES[prefix];
    if (!type) {
      return null;
    }

    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    const sessionYear = date.getMonth() >= 9 ? date.getFullYear() : date.getFullYear() - 1;
    const sagPathNumber = `${prefix.toLowerCase()}${number}${(suffix || "").toLowerCase()}`;
    return `https://www.ft.dk/samling/${sessionYear}1/${type}/${sagPathNumber}/index.htm`;
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

  const CONSTITUENCY_LABELS = [
    "Bornholms Storkreds",
    "Fyns Storkreds",
    "Københavns Omegns Storkreds",
    "Københavns Storkreds",
    "Nordjyllands Storkreds",
    "Nordsjællands Storkreds",
    "Sjællands Storkreds",
    "Sydjyllands Storkreds",
    "Vestjyllands Storkreds",
    "Østjyllands Storkreds",
    "Færøerne",
    "Grønland",
  ];

  function profileConstituencyLabel(profile) {
    const direct = String(profile?.storkreds || "").trim();
    if (CONSTITUENCY_LABELS.includes(direct)) {
      return direct;
    }

    const candidates = [
      profile?.constituency,
      ...(Array.isArray(profile?.constituency_history) ? profile.constituency_history : []),
      direct,
    ]
      .filter(Boolean)
      .map((value) => String(value).trim());

    for (const candidate of candidates) {
      const match = CONSTITUENCY_LABELS.find((label) => candidate.includes(label));
      if (match) {
        return match;
      }
    }

    return direct;
  }

  function isCurrentProfile(profile) {
    return Boolean(profile?.current_party) && Boolean(profile?.constituency);
  }

  function countCurrentProfiles(profiles) {
    if (!Array.isArray(profiles)) {
      return 0;
    }
    return profiles.filter(isCurrentProfile).length;
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

  function compactNormalisedText(value) {
    return (value || "").replace(/[\s-]+/g, "");
  }

  function initFooterFavoritesLink() {
    const footerLinks = document.querySelector(".footer-links");
    if (!footerLinks) {
      return;
    }

    if (footerLinks.querySelector("[data-footer-link='favorites']")) {
      return;
    }

    const link = document.createElement("a");
    link.href = toSiteUrl("favoritter.html");
    link.dataset.footerLink = "favorites";
    link.textContent = "Favoritter";

    const firstLink = footerLinks.querySelector("a");
    if (firstLink) {
      footerLinks.insertBefore(link, firstLink.nextSibling);
      return;
    }

    footerLinks.append(link);
  }

  function isCurrentSitePage(filename) {
    const pathname = (window.location.pathname || "").replace(/\/+$/, "");
    return pathname.endsWith(`/${filename}`) || pathname.endsWith(filename);
  }

  function initHeaderParliamentMenu() {
    const nav = document.querySelector(".site-nav");
    if (!nav || nav.querySelector("[data-nav-dropdown='parliament']")) {
      return;
    }

    const parentLink = Array.from(nav.querySelectorAll("a")).find((link) => {
      try {
        return new URL(link.getAttribute("href") || "", window.location.href).pathname.endsWith("/folketinget.html");
      } catch (error) {
        return false;
      }
    });

    if (!parentLink) {
      return;
    }

    const dropdown = document.createElement("div");
    dropdown.className = "site-nav-dropdown";
    dropdown.dataset.navDropdown = "parliament";

    const parentHref = parentLink.getAttribute("href") || toSiteUrl("folketinget.html");
    const parentIsCurrent = isCurrentSitePage("folketinget.html");
    const childPages = [
      { href: toSiteUrl("folketinget.html"), label: "Overblik", current: false },
      { href: toSiteUrl("moeder.html"), label: "Møder", current: isCurrentSitePage("moeder.html") },
      { href: toSiteUrl("partier.html"), label: "Partier", current: isCurrentSitePage("partier.html") },
    ];
    const sectionIsCurrent = parentIsCurrent || childPages.some((item) => item.current);

    if (sectionIsCurrent) {
      dropdown.dataset.navCurrent = "true";
    }

    const nextParentLink = document.createElement("a");
    nextParentLink.href = parentHref;
    nextParentLink.className = "site-nav-dropdown-link";
    nextParentLink.dataset.navParent = "parliament";
    nextParentLink.textContent = "Folketinget";

    if (parentIsCurrent) {
      nextParentLink.setAttribute("aria-current", "page");
    }

    const submenu = document.createElement("div");
    submenu.className = "site-nav-submenu";
    submenu.setAttribute("aria-label", "Undersider under Folketinget");

    childPages.forEach((item) => {
      const link = document.createElement("a");
      link.href = item.href;
      link.textContent = item.label;
      link.dataset.navSublink = item.label.toLowerCase();
      if (item.current) {
        link.setAttribute("aria-current", "page");
      }
      submenu.append(link);
    });

    dropdown.append(nextParentLink, submenu);
    parentLink.replaceWith(dropdown);
  }

  function initHeaderFavoritesLink() {
    const nav = document.querySelector(".site-nav");
    if (!nav) {
      return;
    }

    const sync = () => {
      const favorites = getFavorites();
      const hasFavorites = favorites.profiles.length > 0 || favorites.cases.length > 0;
      const isFavoritesPage = window.location.pathname.endsWith("/favoritter.html") || window.location.pathname.endsWith("favoritter.html");
      let link = nav.querySelector("[data-nav-link='favorites']");

      if (!hasFavorites && !isFavoritesPage) {
        link?.remove();
        return;
      }

      if (!link) {
        link = document.createElement("a");
        link.href = toSiteUrl("favoritter.html");
        link.dataset.navLink = "favorites";
        link.textContent = "Favoritter";
        nav.append(link);
      }

      if (isFavoritesPage) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    };

    sync();
    window.addEventListener(FAVORITES_EVENT_NAME, sync);
  }

  function buildCaseNumberVariants(value) {
    const normalised = normaliseText(value);
    if (!normalised) {
      return [];
    }

    const variants = new Set([normalised, compactNormalisedText(normalised)]);
    const match = normalised.match(/^([a-zæøå]+)\s*(\d+)\s*([a-z]?)$/u);
    if (match) {
      const [, prefix, number, suffix] = match;
      const suffixPart = suffix || "";
      variants.add(`${prefix} ${number}${suffixPart}`.trim());
      variants.add(`${prefix}${number}${suffixPart}`);
      if (suffixPart) {
        variants.add(`${prefix} ${number} ${suffixPart}`);
      }
    }

    return Array.from(variants).filter(Boolean);
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
    return notes;
  }

  // Scheduled CI refresh times in UTC: { days: [weekday indices 0=Sun], hour, minute }
  // Must stay in sync with .github/workflows/refresh-data.yml
  const REFRESH_SCHEDULE_UTC = [
    { days: [1, 2, 3, 4, 5], hour: 5, minute: 45 },   // weekdays 05:45 UTC
    { days: [1, 2, 3, 4, 5], hour: 17, minute: 30 },  // weekdays 17:30 UTC
    { days: [6], hour: 9, minute: 0 },                 // Saturday 09:00 UTC
  ];

  function computeNextRefresh() {
    const now = new Date();
    let best = null;
    for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
      for (const slot of REFRESH_SCHEDULE_UTC) {
        const candidate = new Date(Date.UTC(
          now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset,
          slot.hour, slot.minute, 0, 0,
        ));
        if (candidate <= now) continue;
        if (!slot.days.includes(candidate.getUTCDay())) continue;
        if (!best || candidate < best) best = candidate;
      }
    }
    return best;
  }

  function formatNextRefresh(date) {
    if (!date) return "-";
    const tz = "Europe/Copenhagen";
    const now = new Date();
    const nowDateStr = now.toLocaleDateString("da-DK", { timeZone: tz });
    const tgtDateStr = date.toLocaleDateString("da-DK", { timeZone: tz });
    const timeFmt = new Intl.DateTimeFormat("da-DK", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
    const timeStr = timeFmt.format(date);
    if (nowDateStr === tgtDateStr) return `kl. ${timeStr}`;
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    if (tgtDateStr === tomorrow.toLocaleDateString("da-DK", { timeZone: tz })) {
      return `i morgen kl. ${timeStr}`;
    }
    const dayFmt = new Intl.DateTimeFormat("da-DK", { timeZone: tz, weekday: "short" });
    return `${dayFmt.format(date)} kl. ${timeStr}`;
  }

  function renderStats(root, stats) {
    if (!root || !stats) {
      return;
    }

    const profileNode = root.querySelector("[data-stat='profiles']");
    const voteNode = root.querySelector("[data-stat='votes']");
    const updatedNode = root.querySelector("[data-stat='updated']");
    const nextNode = root.querySelector("[data-stat='next-update']");

    if (profileNode) {
      profileNode.textContent = formatNumber(stats.counts?.profiles);
    }
    if (voteNode) {
      voteNode.textContent = formatNumber(stats.counts?.votes);
    }
    if (updatedNode) {
      const d = stats.generated_at ? new Date(stats.generated_at) : null;
      if (d) {
        const tz = "Europe/Copenhagen";
        const datePart = new Intl.DateTimeFormat("da-DK", { timeZone: tz, day: "numeric", month: "short" }).format(d);
        const timePart = new Intl.DateTimeFormat("da-DK", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(d);
        updatedNode.textContent = `${datePart} kl. ${timePart}`;
      } else {
        updatedNode.textContent = "-";
      }
    }
    if (nextNode) {
      nextNode.textContent = formatNextRefresh(computeNextRefresh());
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
    const utility = document.createElement("div");
    utility.className = "site-header-utility";

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
    tools.append(utility, stats);
    utility.append(toggle);
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

  function initGlobalSearch() {
    const tools = document.querySelector(".site-header-tools");
    if (!tools) {
      return;
    }
    const utility = tools.querySelector(".site-header-utility") || tools;

    const trigger = buildGlobalSearchTrigger();
    const overlay = buildGlobalSearchOverlay();
    globalSearchState.elements = { trigger, ...overlay };

    utility.insertBefore(trigger, utility.firstChild);
    document.body.append(overlay.root);

    trigger.addEventListener("click", () => {
      openGlobalSearch();
    });

    overlay.close.addEventListener("click", () => {
      closeGlobalSearch();
    });

    overlay.backdrop.addEventListener("click", () => {
      closeGlobalSearch();
    });

    overlay.input.addEventListener("input", (event) => {
      globalSearchState.query = event.target.value;
      renderGlobalSearch();
    });

    overlay.input.addEventListener("keydown", (event) => {
      handleGlobalSearchInputKeydown(event);
    });

    overlay.results.addEventListener("mouseover", (event) => {
      const result = event.target.closest("[data-search-index]");
      if (!result) {
        return;
      }
      globalSearchState.activeIndex = Number(result.dataset.searchIndex);
      syncActiveGlobalSearchResult(false);
    });

    overlay.results.addEventListener("focusin", (event) => {
      const result = event.target.closest("[data-search-index]");
      if (!result) {
        return;
      }
      globalSearchState.activeIndex = Number(result.dataset.searchIndex);
      syncActiveGlobalSearchResult(false);
    });

    document.addEventListener("keydown", (event) => {
      if (isGlobalSearchShortcut(event)) {
        event.preventDefault();
        openGlobalSearch();
        return;
      }

      if (event.key === "Escape" && globalSearchState.open) {
        event.preventDefault();
        closeGlobalSearch();
      }
    });

    warmGlobalSearchIndex();
  }

  function buildGlobalSearchTrigger() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "global-search-trigger";
    button.setAttribute("aria-label", "Søg i hele Folkevalget");
    button.innerHTML = `
      <span class="global-search-trigger-label">Søg i hele Folkevalget</span>
      <span class="global-search-trigger-shortcut" data-search-shortcut></span>
    `;

    const shortcut = button.querySelector("[data-search-shortcut]");
    if (shortcut) {
      shortcut.textContent = keyboardShortcutLabel();
    }

    return button;
  }

  function buildGlobalSearchOverlay() {
    const root = document.createElement("div");
    root.className = "global-search";
    root.hidden = true;

    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "global-search-backdrop";
    backdrop.setAttribute("aria-label", "Luk søgning");

    const shell = document.createElement("section");
    shell.className = "global-search-shell";
    shell.setAttribute("role", "dialog");
    shell.setAttribute("aria-modal", "true");
    shell.setAttribute("aria-labelledby", "global-search-status");

    const head = document.createElement("div");
    head.className = "global-search-head";

    const label = document.createElement("label");
    label.className = "sr-only";
    label.setAttribute("for", "global-search-input");
    label.textContent = "Søg i hele Folkevalget";

    const input = document.createElement("input");
    input.id = "global-search-input";
    input.className = "global-search-input";
    input.type = "search";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "Navn, parti, storkreds eller sagsnummer";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "global-search-close";
    close.textContent = "Luk";

    const status = document.createElement("p");
    status.className = "global-search-status";
    status.id = "global-search-status";
    status.setAttribute("aria-live", "polite");

    const results = document.createElement("div");
    results.className = "global-search-results";

    head.append(label, input, close);
    shell.append(head, status, results);
    root.append(backdrop, shell);

    return { root, backdrop, shell, input, close, status, results };
  }

  function keyboardShortcutLabel() {
    return globalSearchState.isMac ? "Cmd K" : "Ctrl K";
  }

  function isGlobalSearchShortcut(event) {
    return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
  }

  function openGlobalSearch() {
    const { root, input } = globalSearchState.elements || {};
    if (!root || !input) {
      return;
    }

    globalSearchState.previousFocus = document.activeElement;
    globalSearchState.open = true;
    globalSearchState.query = "";
    globalSearchState.activeIndex = -1;
    globalSearchState.results = [];
    root.hidden = false;
    document.body.classList.add("global-search-open");
    input.value = "";
    renderGlobalSearch();
    input.focus();
  }

  function closeGlobalSearch() {
    const { root, trigger } = globalSearchState.elements || {};
    if (!root) {
      return;
    }

    const previousFocus = globalSearchState.previousFocus;
    globalSearchState.open = false;
    globalSearchState.activeIndex = -1;
    globalSearchState.results = [];
    globalSearchState.resultNodes = [];
    globalSearchState.previousFocus = null;
    document.body.classList.remove("global-search-open");
    root.hidden = true;

    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus();
      return;
    }

    trigger?.focus();
  }

  function warmGlobalSearchIndex() {
    const startWarmup = () => {
      loadGlobalSearchIndex().catch((error) => {
        console.error(error);
      });
    };

    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(startWarmup, { timeout: 1800 });
      return;
    }

    window.setTimeout(startWarmup, 900);
  }

  async function loadGlobalSearchIndex() {
    if (globalSearchState.index) {
      return globalSearchState.index;
    }

    if (globalSearchIndexPromise) {
      return globalSearchIndexPromise;
    }

    globalSearchIndexPromise = Promise.all([
      loadCatalogueData(),
      loadVoteOverview().catch(() => []),
    ])
      .then(([{ profiles }, votes]) => {
        const index = buildGlobalSearchIndex(profiles, Array.isArray(votes) ? votes : []);
        globalSearchState.index = index;
        return index;
      })
      .catch((error) => {
        globalSearchIndexPromise = null;
        throw error;
      });

    return globalSearchIndexPromise;
  }

  function buildGlobalSearchIndex(profiles, votes) {
    return [
      ...buildProfileSearchItems(profiles),
      ...buildVoteSearchItems(votes),
      ...buildPartySearchItems(profiles),
      ...buildConstituencySearchItems(profiles),
    ];
  }

  function buildProfileSearchItems(profiles) {
    return (profiles || []).map((profile) => {
      const current = isCurrentProfile(profile);
      const constituencyLabel = profileConstituencyLabel(profile);
      const partyName = partyDisplayName(
        profile.current_party || profile.party,
        profile.current_party_short || profile.party_short
      );
      const meta = [partyName, constituencyLabel || (current ? profile.constituency : "Tidligere medlem")]
        .filter(Boolean)
        .join(" · ");
      const searchParts = [
        profile.name,
        profile.first_name,
        profile.last_name,
        profile.current_party,
        profile.current_party_short,
        profile.party,
        profile.party_short,
        profile.role,
        constituencyLabel,
        profile.storkreds,
        profile.constituency,
        ...(profile.committees || []).map((committee) => `${committee.short_name || ""} ${committee.name || ""}`),
      ];

      return createSearchItem({
        kind: "profile",
        title: profile.name || "Ukendt profil",
        meta,
        trailing: profile.current_party_short || profile.party_short || "",
        href: buildProfileUrl(profile.id),
        searchParts,
        exactTerms: [profile.name],
        priority: current ? 260 : 180,
      });
    });
  }

  function buildVoteSearchItems(votes) {
    return (votes || []).map((vote) => {
      const title = vote.sag_short_title || vote.sag_title || vote.sag_number || "Afstemning";
      const caseNumberVariants = buildCaseNumberVariants(vote.sag_number);
      const meta = [vote.sag_number || `Afstemning ${vote.nummer || ""}`, formatDate(vote.date), vote.vedtaget ? "Vedtaget" : "Forkastet"]
        .filter(Boolean)
        .join(" · ");
      const searchParts = [
        vote.sag_number,
        ...caseNumberVariants,
        vote.sag_short_title,
        vote.sag_title,
        vote.sag_resume,
        vote.type,
        vote.sagstrin_title,
        vote.date,
        vote.konklusion,
      ];

      return createSearchItem({
        kind: "vote",
        title,
        meta,
        trailing: vote.sag_number || "",
        href: buildVoteUrl(vote.afstemning_id),
        searchParts,
        exactTerms: [vote.sag_number, ...caseNumberVariants, String(vote.afstemning_id || "")],
        priority: 220,
        date: vote.date,
      });
    });
  }

  function buildPartySearchItems(profiles) {
    const groups = new Map();

    for (const profile of (profiles || []).filter(isCurrentProfile)) {
      const shortName = profile.current_party_short || profile.party_short || "";
      const partyName = profile.current_party || profile.party || shortName || "Ukendt parti";
      const key = shortName || partyName;
      if (!groups.has(key)) {
        groups.set(key, {
          shortName,
          partyName,
          memberCount: 0,
        });
      }

      groups.get(key).memberCount += 1;
    }

    return [...groups.values()].map((party) =>
      createSearchItem({
        kind: "party",
        title: partyDisplayName(party.partyName, party.shortName),
        meta: `${formatNumber(party.memberCount)} nuværende medlemmer`,
        trailing: party.shortName || "",
        href: `${toSiteUrl("discover.html")}?party=${encodeURIComponent(party.shortName || party.partyName)}`,
        searchParts: [party.partyName, party.shortName],
        exactTerms: [party.partyName, party.shortName],
        priority: 200,
      })
    );
  }

  function buildConstituencySearchItems(profiles) {
    const groups = new Map();

    for (const profile of (profiles || []).filter(isCurrentProfile)) {
      const constituencyLabel = profileConstituencyLabel(profile);
      if (!constituencyLabel) {
        continue;
      }

      groups.set(constituencyLabel, (groups.get(constituencyLabel) || 0) + 1);
    }

    return [...groups.entries()].map(([storkreds, memberCount]) =>
      createSearchItem({
        kind: "constituency",
        title: storkreds,
        meta: `${formatNumber(memberCount)} nuværende medlemmer`,
        trailing: "",
        href: `${toSiteUrl("discover.html")}?storkreds=${encodeURIComponent(storkreds)}`,
        searchParts: [storkreds],
        exactTerms: [storkreds],
        priority: 170,
      })
    );
  }

  function createSearchItem({ kind, title, meta, trailing, href, searchParts, exactTerms, priority, date = null }) {
    const searchText = normaliseText((searchParts || []).filter(Boolean).join(" "));
    const titleText = normaliseText(title);
    const titleWords = titleText.split(" ").filter(Boolean);
    const searchWords = searchText.split(" ").filter(Boolean);
    const titleCompact = compactNormalisedText(titleText);
    const searchCompact = compactNormalisedText(searchText);
    const normalisedExactTerms = (exactTerms || []).map((entry) => normaliseText(entry)).filter(Boolean);
    const exactTermCompacts = normalisedExactTerms.map((entry) => compactNormalisedText(entry)).filter(Boolean);

    return {
      kind,
      title,
      meta,
      trailing,
      href,
      date,
      priority,
      titleText,
      titleWords,
      titleCompact,
      searchText,
      searchWords,
      searchCompact,
      exactTerms: normalisedExactTerms,
      exactTermCompacts,
    };
  }

  function renderGlobalSearch() {
    const { status, results } = globalSearchState.elements || {};
    if (!status || !results) {
      return;
    }

    const query = globalSearchState.query.trim();
    if (!query) {
      globalSearchState.results = [];
      globalSearchState.activeIndex = -1;
      status.textContent = "Søg i profiler, afstemninger, partier og storkredse.";
      results.innerHTML = `
        <div class="global-search-empty">
          <p>Skriv et navn, et parti, en storkreds eller et sagsnummer.</p>
          <p>Eksempler: "Mette Frederiksen", "L 92", "Venstre", "Københavns Storkreds".</p>
        </div>
      `;
      globalSearchState.resultNodes = [];
      return;
    }

    if (!globalSearchState.index) {
      status.textContent = "Indlæser søgning...";
      results.innerHTML = '<div class="global-search-empty"><p>Indlæser profiler og afstemninger...</p></div>';
      loadGlobalSearchIndex()
        .then(() => {
          if (globalSearchState.open) {
            renderGlobalSearch();
          }
        })
        .catch((error) => {
          console.error(error);
          if (globalSearchState.open) {
            status.textContent = "Søgning kunne ikke indlæses.";
            results.innerHTML = '<div class="global-search-empty"><p>Søgningen kunne ikke indlæses lige nu.</p></div>';
          }
        });
      return;
    }

    const matchState = findGlobalSearchResults(query);
    const displayItems = GLOBAL_SEARCH_SECTION_ORDER.flatMap((sectionKey) =>
      matchState.items.filter((item) => item.kind === sectionKey)
    );
    globalSearchState.results = displayItems;
    globalSearchState.activeIndex = displayItems.length > 0 ? 0 : -1;

    if (matchState.totalMatches === 0) {
      status.textContent = "Ingen resultater.";
      results.innerHTML = '<div class="global-search-empty"><p>Ingen resultater matcher søgningen.</p></div>';
      globalSearchState.resultNodes = [];
      return;
    }

    status.textContent = `${formatNumber(matchState.totalMatches)} resultater fundet`;
    results.innerHTML = "";

    for (const sectionKey of GLOBAL_SEARCH_SECTION_ORDER) {
      const sectionItems = displayItems.filter((item) => item.kind === sectionKey);
      if (sectionItems.length === 0) {
        continue;
      }

      results.append(buildGlobalSearchSection(sectionKey, sectionItems));
    }

    globalSearchState.resultNodes = Array.from(results.querySelectorAll("[data-search-index]"));
    syncActiveGlobalSearchResult(false);
  }

  function findGlobalSearchResults(rawQuery) {
    const query = normaliseText(rawQuery);
    const tokens = query.split(" ").filter(Boolean);
    const matches = globalSearchState.index
      .map((item) => ({
        item,
        score: scoreGlobalSearchItem(item, query, tokens),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        if (left.item.kind !== right.item.kind) {
          return GLOBAL_SEARCH_SECTION_ORDER.indexOf(left.item.kind) - GLOBAL_SEARCH_SECTION_ORDER.indexOf(right.item.kind);
        }

        return left.item.title.localeCompare(right.item.title, "da");
      });

    const visible = [];
    const perSectionCounts = new Map();

    for (const entry of matches) {
      const currentCount = perSectionCounts.get(entry.item.kind) || 0;
      if (currentCount >= GLOBAL_SEARCH_PER_SECTION) {
        continue;
      }

      visible.push(entry.item);
      perSectionCounts.set(entry.item.kind, currentCount + 1);

      if (visible.length >= GLOBAL_SEARCH_RESULT_LIMIT) {
        break;
      }
    }

    return {
      items: visible,
      totalMatches: matches.length,
    };
  }

  function scoreGlobalSearchItem(item, query, tokens) {
    if (!query) {
      return 0;
    }

    const queryCompact = compactNormalisedText(query);
    let score = item.priority || 0;
    if (item.exactTerms.includes(query)) {
      score += 900;
    }
    if (queryCompact && item.exactTermCompacts.includes(queryCompact)) {
      score += 860;
    }
    if (item.titleText === query) {
      score += 700;
    }
    if (queryCompact && item.titleCompact === queryCompact) {
      score += 660;
    }
    if (item.titleText.startsWith(query)) {
      score += 420;
    }
    if (queryCompact && item.titleCompact.startsWith(queryCompact)) {
      score += 390;
    }
    if (item.searchText.includes(query)) {
      score += 140;
    }
    if (queryCompact && queryCompact.length >= 3 && item.searchCompact.includes(queryCompact)) {
      score += 130;
    }

    for (const token of tokens) {
      let matched = false;
      const tokenCompact = compactNormalisedText(token);

      if (item.exactTerms.includes(token)) {
        score += 260;
        matched = true;
      } else if (tokenCompact && item.exactTermCompacts.includes(tokenCompact)) {
        score += 230;
        matched = true;
      } else if (item.titleWords.some((word) => word === token)) {
        score += 120;
        matched = true;
      } else if (item.titleWords.some((word) => word.startsWith(token))) {
        score += 90;
        matched = true;
      } else if (item.searchWords.some((word) => word === token)) {
        score += 60;
        matched = true;
      } else if (item.searchWords.some((word) => word.startsWith(token))) {
        score += 45;
        matched = true;
      } else if (item.searchText.includes(token)) {
        score += 20;
        matched = true;
      } else if (tokenCompact && tokenCompact.length >= 3 && item.searchCompact.includes(tokenCompact)) {
        score += 18;
        matched = true;
      }

      if (!matched) {
        return -1;
      }
    }

    if (item.kind === "vote" && item.date) {
      const daysOld = Math.max(0, Math.floor((Date.now() - new Date(item.date).getTime()) / 86400000));
      score += Math.max(0, 40 - Math.min(daysOld / 30, 40));
    }

    return score;
  }

  function buildGlobalSearchSection(sectionKey, items) {
    const section = document.createElement("section");
    section.className = "global-search-section";

    const heading = document.createElement("h2");
    heading.className = "global-search-section-title";
    heading.textContent = GLOBAL_SEARCH_SECTION_LABELS[sectionKey] || sectionKey;

    const list = document.createElement("ul");
    list.className = "global-search-list";

    items.forEach((item) => {
      const globalIndex = globalSearchState.results.indexOf(item);
      const row = document.createElement("li");
      const link = document.createElement("a");
      link.className = "global-search-result";
      link.href = item.href;
      link.dataset.searchIndex = String(globalIndex);

      const copy = document.createElement("div");
      copy.className = "global-search-result-copy";

      const title = document.createElement("span");
      title.className = "global-search-result-title";
      title.textContent = item.title;

      const meta = document.createElement("span");
      meta.className = "global-search-result-meta";
      meta.textContent = item.meta || "";

      copy.append(title);
      if (item.meta) {
        copy.append(meta);
      }

      const trailing = document.createElement("span");
      trailing.className = "global-search-result-trailing";
      trailing.textContent = item.trailing || "";

      link.append(copy);
      if (item.trailing) {
        link.append(trailing);
      }

      row.append(link);
      list.append(row);
    });

    section.append(heading, list);
    return section;
  }

  function handleGlobalSearchInputKeydown(event) {
    if (!globalSearchState.open) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveGlobalSearchSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveGlobalSearchSelection(-1);
      return;
    }

    if (event.key === "Enter" && globalSearchState.activeIndex >= 0) {
      event.preventDefault();
      openGlobalSearchResult(globalSearchState.activeIndex, event.metaKey || event.ctrlKey);
    }
  }

  function moveGlobalSearchSelection(delta) {
    if (globalSearchState.results.length === 0) {
      return;
    }

    const lastIndex = globalSearchState.results.length - 1;
    const nextIndex =
      globalSearchState.activeIndex < 0
        ? 0
        : Math.max(0, Math.min(lastIndex, globalSearchState.activeIndex + delta));

    globalSearchState.activeIndex = nextIndex;
    syncActiveGlobalSearchResult();
  }

  function syncActiveGlobalSearchResult(shouldScroll = true) {
    globalSearchState.resultNodes.forEach((node, index) => {
      node.classList.toggle("is-active", index === globalSearchState.activeIndex);
      node.setAttribute("aria-selected", String(index === globalSearchState.activeIndex));
    });

    if (!shouldScroll || globalSearchState.activeIndex < 0) {
      return;
    }

    globalSearchState.resultNodes[globalSearchState.activeIndex]?.scrollIntoView({
      block: "nearest",
    });
  }

  function openGlobalSearchResult(resultIndex, inNewTab = false) {
    const result = globalSearchState.results[resultIndex];
    if (!result) {
      return;
    }

    closeGlobalSearch();
    if (inNewTab) {
      window.open(result.href, "_blank", "noopener");
      return;
    }

    window.location.href = result.href;
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

  function readFavoritesStore() {
    const fallback = { profiles: {}, cases: {} };
    try {
      const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) {
        return fallback;
      }

      const parsed = JSON.parse(raw);
      const profiles = parsed?.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {};
      const cases = parsed?.cases && typeof parsed.cases === "object" ? parsed.cases : {};
      return { profiles, cases };
    } catch (error) {
      return fallback;
    }
  }

  function writeFavoritesStore(store) {
    try {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(store));
    } catch (error) {}
  }

  function normaliseCaseNumber(caseNumber) {
    return String(caseNumber || "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function normaliseIsoDate(value) {
    const text = String(value || "").trim();
    if (!text) {
      return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString().slice(0, 10);
  }

  function buildFavoritesSnapshot(store) {
    const profiles = Object.values(store?.profiles || {}).sort((left, right) =>
      String(right?.saved_at || "").localeCompare(String(left?.saved_at || ""))
    );
    const cases = Object.values(store?.cases || {}).sort((left, right) =>
      String(right?.saved_at || "").localeCompare(String(left?.saved_at || ""))
    );
    return { profiles, cases };
  }

  function emitFavoritesChanged(store) {
    window.dispatchEvent(
      new CustomEvent(FAVORITES_EVENT_NAME, {
        detail: buildFavoritesSnapshot(store),
      })
    );
  }

  function getFavorites() {
    return buildFavoritesSnapshot(readFavoritesStore());
  }

  function isFavoriteProfile(profileId) {
    const id = Number(profileId || 0);
    if (!Number.isFinite(id) || id <= 0) {
      return false;
    }
    const store = readFavoritesStore();
    return Boolean(store.profiles[String(id)]);
  }

  function isFavoriteCase(caseNumber) {
    const key = normaliseCaseNumber(caseNumber);
    if (!key) {
      return false;
    }
    const store = readFavoritesStore();
    return Boolean(store.cases[key]);
  }

  function setFavoriteProfile(profile, shouldFavorite = true) {
    const id = Number(profile?.id || 0);
    if (!Number.isFinite(id) || id <= 0) {
      return false;
    }

    const store = readFavoritesStore();
    const key = String(id);

    if (shouldFavorite) {
      store.profiles[key] = {
        id,
        name: String(profile?.name || "").trim() || `Profil ${id}`,
        party_short: String(profile?.party_short || "").trim() || null,
        party: String(profile?.party || "").trim() || null,
        saved_at: new Date().toISOString(),
      };
    } else {
      delete store.profiles[key];
    }

    writeFavoritesStore(store);
    emitFavoritesChanged(store);
    return Boolean(store.profiles[key]);
  }

  function toggleFavoriteProfile(profile) {
    const id = Number(profile?.id || 0);
    if (!Number.isFinite(id) || id <= 0) {
      return false;
    }
    const active = isFavoriteProfile(id);
    return setFavoriteProfile(profile, !active);
  }

  function setFavoriteCase(caseData, shouldFavorite = true) {
    const caseNumber = normaliseCaseNumber(caseData?.sag_number || caseData?.case_number);
    if (!caseNumber) {
      return false;
    }

    const store = readFavoritesStore();
    const existing = store.cases[caseNumber] || null;

    if (shouldFavorite) {
      const statusSnapshot =
        String(caseData?.sag_status || caseData?.sagstrin_status || existing?.saved_status || "").trim() || null;
      store.cases[caseNumber] = {
        sag_number: caseNumber,
        sag_id: Number(caseData?.sag_id || 0) || null,
        title: String(caseData?.sag_short_title || caseData?.sag_title || "").trim() || caseNumber,
        type: String(caseData?.type || caseData?.sag_type || "").trim() || null,
        saved_status: statusSnapshot,
        saved_latest_vote_id: Number(caseData?.afstemning_id || existing?.saved_latest_vote_id || 0) || null,
        saved_latest_vote_date:
          normaliseIsoDate(caseData?.date || existing?.saved_latest_vote_date) || null,
        saved_at: String(existing?.saved_at || "") || new Date().toISOString(),
      };
    } else {
      delete store.cases[caseNumber];
    }

    writeFavoritesStore(store);
    emitFavoritesChanged(store);
    return Boolean(store.cases[caseNumber]);
  }

  function toggleFavoriteCase(caseData) {
    const caseNumber = normaliseCaseNumber(caseData?.sag_number || caseData?.case_number);
    if (!caseNumber) {
      return false;
    }
    const active = isFavoriteCase(caseNumber);
    return setFavoriteCase(caseData, !active);
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
    loadVoteDetailById,
    loadVoteDetails,
    loadVoteOverview,
    normaliseText,
    getFavorites,
    isFavoriteProfile,
    isFavoriteCase,
    setFavoriteProfile,
    toggleFavoriteProfile,
    setFavoriteCase,
    toggleFavoriteCase,
    FAVORITES_EVENT_NAME,
    partyDisplayName,
    photoCreditText,
    profileConstituencyLabel,
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
