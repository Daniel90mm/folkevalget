const state = {
  profiles: [],
  votesById: new Map(),
  filteredProfiles: [],
  selectedId: null,
  partyFilter: "",
  query: "",
  sortMode: "name",
  stats: null,
};

const siteBasePath = detectSiteBasePath();
const bootstrapPayload = readBootstrapPayload();

const profileGrid = document.querySelector("#profile-grid");
const partyFilter = document.querySelector("#party-filter");
const sortSelect = document.querySelector("#sort-select");
const searchInput = document.querySelector("#search-input");
const resultCount = document.querySelector("#result-count");
const detailEmpty = document.querySelector("#detail-empty");
const detailCard = document.querySelector("#detail-card");
const heroStats = {
  profiles: document.querySelector("[data-stat='profiles']"),
  votes: document.querySelector("[data-stat='votes']"),
  updated: document.querySelector("[data-stat='updated']"),
};

const detail = {
  party: document.querySelector("#detail-party"),
  photo: document.querySelector("#detail-photo"),
  name: document.querySelector("#detail-name"),
  role: document.querySelector("#detail-role"),
  link: document.querySelector("#detail-link"),
  attendance: document.querySelector("#metric-attendance"),
  loyalty: document.querySelector("#metric-loyalty"),
  votesFor: document.querySelector("#metric-for"),
  votesAgainst: document.querySelector("#metric-against"),
  committees: document.querySelector("#detail-committees"),
  votes: document.querySelector("#detail-votes"),
};

const cardTemplate = document.querySelector("#profile-card-template");

boot().catch((error) => {
  console.error(error);
  profileGrid.innerHTML = '<div class="empty-state">Kunne ikke indlæse data.</div>';
  resultCount.textContent = "Fejl ved indlæsning";
});

async function boot() {
  const bootstrapProfiles = Array.isArray(bootstrapPayload?.profiles)
    ? bootstrapPayload.profiles
    : null;
  const bootstrapStats = bootstrapPayload?.stats ?? null;

  const [profilesResult, votesResult, statsResult] = await Promise.allSettled([
    bootstrapProfiles ? Promise.resolve(bootstrapProfiles) : fetchJson("data/profiler.json"),
    fetchJson("data/afstemninger.json"),
    bootstrapStats ? Promise.resolve(bootstrapStats) : fetchJson("data/site_stats.json"),
  ]);

  if (profilesResult.status !== "fulfilled") {
    throw profilesResult.reason;
  }

  const profiles = profilesResult.value;
  const votes = votesResult.status === "fulfilled" ? votesResult.value : [];
  const stats =
    statsResult.status === "fulfilled"
      ? statsResult.value
      : {
          generated_at: null,
          counts: {
            profiles: profiles.length,
            votes: votes.length,
          },
        };

  if (votesResult.status !== "fulfilled") {
    console.warn("Could not load vote index", votesResult.reason);
  }

  if (statsResult.status !== "fulfilled") {
    console.warn("Could not load site stats", statsResult.reason);
  }

  state.profiles = profiles;
  state.filteredProfiles = profiles.slice();
  state.stats = stats;
  state.votesById = new Map(votes.map((vote) => [vote.afstemning_id, vote]));

  populatePartyFilter(profiles);
  renderHeroStats(stats);
  bindEvents();
  applyFilters();
}

function bindEvents() {
  searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    applyFilters();
  });

  partyFilter.addEventListener("change", (event) => {
    state.partyFilter = event.target.value;
    applyFilters();
  });

  sortSelect.addEventListener("change", (event) => {
    state.sortMode = event.target.value;
    applyFilters();
  });
}

function populatePartyFilter(profiles) {
  const partyOptions = new Map();
  for (const profile of profiles) {
    const partyValue = profile.party_short || profile.party;
    if (!partyValue || partyOptions.has(partyValue)) {
      continue;
    }
    partyOptions.set(partyValue, partyDisplayName(profile.party, profile.party_short));
  }

  const parties = Array.from(partyOptions.entries()).sort((left, right) =>
    left[1].localeCompare(right[1], "da")
  );

  for (const [partyValue, partyLabel] of parties) {
    const option = document.createElement("option");
    option.value = partyValue;
    option.textContent = partyLabel;
    partyFilter.append(option);
  }
}

function renderHeroStats(stats) {
  heroStats.profiles.textContent = formatNumber(stats.counts.profiles);
  heroStats.votes.textContent = formatNumber(stats.counts.votes);
  heroStats.updated.textContent = formatDate(stats.generated_at);
}

function applyFilters() {
  state.filteredProfiles = state.profiles.filter((profile) => {
    const partyValue = profile.party_short || profile.party || "";
    const searchable = [profile.name, profile.party, profile.party_short]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesParty = !state.partyFilter || partyValue === state.partyFilter;
    const matchesQuery = !state.query || searchable.includes(state.query);
    return matchesParty && matchesQuery;
  });

  state.filteredProfiles.sort(compareProfiles);
  renderProfiles();

  if (!state.filteredProfiles.some((profile) => profile.id === state.selectedId)) {
    if (state.filteredProfiles.length > 0) {
      selectProfile(state.filteredProfiles[0].id);
    } else {
      state.selectedId = null;
      renderDetail(null);
    }
  }
}

function renderProfiles() {
  profileGrid.innerHTML = "";

  if (state.filteredProfiles.length === 0) {
    profileGrid.innerHTML = '<div class="empty-state">Ingen profiler matcher din søgning.</div>';
    resultCount.textContent = "0 profiler";
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const profile of state.filteredProfiles) {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.id = String(profile.id);
    if (profile.id === state.selectedId) {
      card.classList.add("is-active");
    }

    const partyLabel = profile.party_short || profile.party || "Uden parti";
    const roleLabel = profile.role || profile.constituency || "Folketingsmedlem";
    const attendanceValue = profile.attendance_pct;
    const loyaltyValue = profile.party_loyalty_pct;

    const pill = card.querySelector(".party-pill");
    pill.textContent = partyLabel;
    pill.title = profile.party || partyLabel;
    pill.dataset.party = profile.party_short || "";

    const avatar = card.querySelector(".card-avatar");
    if (profile.photo_url) {
      avatar.src = profile.photo_url;
      avatar.alt = profile.name;
      avatar.classList.remove("hidden");
    }
    card.querySelector(".profile-name").textContent = profile.name;
    card.querySelector(".profile-role").textContent = roleLabel;
    card.querySelector(".profile-role").title = roleLabel;
    card.querySelector(".profile-attendance").textContent = formatPercent(attendanceValue);
    card.querySelector(".profile-loyalty").textContent = formatPercent(loyaltyValue);
    card.querySelector(".profile-votes-for").textContent = `${formatNumber(profile.votes_for)} for`;
    card.querySelector(".profile-votes-against").textContent =
      `${formatNumber(profile.votes_against)} imod`;

    setMeter(
      card.querySelector(".profile-attendance-bar"),
      attendanceValue,
      card.querySelector(".mini-stat-attendance"),
      "attendance"
    );
    setMeter(
      card.querySelector(".profile-loyalty-bar"),
      loyaltyValue,
      card.querySelector(".mini-stat-loyalty"),
      "loyalty"
    );

    card.addEventListener("click", () => selectProfile(profile.id));
    fragment.append(card);
  }

  profileGrid.append(fragment);
  resultCount.textContent = `${state.filteredProfiles.length} profiler`;
}

function selectProfile(profileId) {
  state.selectedId = profileId;
  renderProfiles();
  renderDetail(state.profiles.find((profile) => profile.id === profileId) || null);
}

function renderDetail(profile) {
  if (!profile) {
    detailEmpty.classList.remove("hidden");
    detailCard.classList.add("hidden");
    return;
  }

  detailEmpty.classList.add("hidden");
  detailCard.classList.remove("hidden");

  detail.party.textContent = partyDisplayName(profile.party, profile.party_short);
  detail.party.title = profile.party || "Uden parti";
  detail.party.dataset.party = profile.party_short || "";

  if (profile.photo_url) {
    detail.photo.src = profile.photo_url;
    detail.photo.alt = profile.name;
    detail.photo.classList.remove("hidden");
  } else {
    detail.photo.classList.add("hidden");
  }

  detail.name.textContent = profile.name;
  detail.role.textContent = [
    profile.role || profile.constituency || "Folketingsmedlem",
    profile.party,
  ]
    .filter(Boolean)
    .join(" · ");
  detail.attendance.textContent = formatPercent(profile.attendance_pct);
  detail.loyalty.textContent = formatPercent(profile.party_loyalty_pct);
  detail.votesFor.textContent = formatNumber(profile.votes_for);
  detail.votesAgainst.textContent = formatNumber(profile.votes_against);

  setMetricTone(detail.attendance.closest(".metric"), profile.attendance_pct, "attendance");
  setMetricTone(detail.loyalty.closest(".metric"), profile.party_loyalty_pct, "loyalty");
  setStaticTone(detail.votesFor.closest(".metric"), "good");
  setStaticTone(detail.votesAgainst.closest(".metric"), "risk");

  if (profile.member_url) {
    detail.link.href = profile.member_url;
    detail.link.classList.remove("hidden");
  } else {
    detail.link.removeAttribute("href");
    detail.link.classList.add("hidden");
  }

  renderCommittees(profile.committees || []);
  renderRecentVotes(profile.recent_votes || []);
}

function renderCommittees(committees) {
  detail.committees.innerHTML = "";

  if (committees.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Ingen aktive udvalg registreret";
    detail.committees.append(item);
    return;
  }

  for (const committee of committees) {
    const item = document.createElement("li");
    const code = document.createElement("strong");
    code.className = "committee-code";
    code.textContent = committee.short_name || "Udvalg";

    const name = document.createElement("span");
    name.className = "committee-name";
    name.textContent = committee.name || committee.short_name || "Ukendt udvalg";

    item.append(code, name);
    detail.committees.append(item);
  }
}

function renderRecentVotes(recentVotes) {
  detail.votes.innerHTML = "";

  if (recentVotes.length === 0) {
    detail.votes.innerHTML = '<li>Ingen stemmer registreret i det valgte udsnit.</li>';
    return;
  }

  for (const vote of recentVotes) {
    const voteContext = state.votesById.get(vote.afstemning_id);
    const item = document.createElement("li");

    const meta = document.createElement("div");
    meta.className = "vote-meta";
    meta.innerHTML = `<span>${vote.sag_number || "Afstemning"}</span><span>${formatDate(vote.date)}</span>`;

    const title = document.createElement("p");
    title.className = "vote-title";
    title.textContent =
      vote.sag_title ||
      voteContext?.sag_short_title ||
      voteContext?.sag_title ||
      "Afstemning uden tilknyttet sagsoverskrift";

    const badge = document.createElement("span");
    badge.className = `vote-badge ${voteBadgeClass(vote.vote_type)}`;
    badge.textContent = vote.vote_type || "Ukendt";

    item.append(meta, title, badge);
    detail.votes.append(item);
  }
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
  if (segments.length === 0) {
    return "/";
  }

  return `/${segments[0]}/`;
}

function toSiteUrl(path) {
  const normalizedPath = path.replace(/^\/+/, "");
  return `${siteBasePath}${normalizedPath}`;
}

function readBootstrapPayload() {
  const payload = window.__FOLKEVALGET_BOOTSTRAP__;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return payload;
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

function compareProfiles(left, right) {
  if (state.sortMode === "attendance_desc") {
    return compareAttendance(left, right, "desc");
  }

  if (state.sortMode === "attendance_asc") {
    return compareAttendance(left, right, "asc");
  }

  if (state.sortMode === "loyalty_desc") {
    return compareLoyalty(left, right, "desc");
  }

  if (state.sortMode === "loyalty_asc") {
    return compareLoyalty(left, right, "asc");
  }

  return compareByName(left, right);
}

function compareLoyalty(left, right, direction) {
  const leftValue = left.party_loyalty_pct;
  const rightValue = right.party_loyalty_pct;
  const leftMissing = leftValue === null || leftValue === undefined;
  const rightMissing = rightValue === null || rightValue === undefined;

  if (leftMissing && rightMissing) {
    return compareByName(left, right);
  }
  if (leftMissing) {
    return 1;
  }
  if (rightMissing) {
    return -1;
  }

  const delta =
    direction === "desc"
      ? Number(rightValue) - Number(leftValue)
      : Number(leftValue) - Number(rightValue);
  if (delta !== 0) {
    return delta;
  }

  return compareByName(left, right);
}

function compareAttendance(left, right, direction) {
  const leftValue = left.attendance_pct;
  const rightValue = right.attendance_pct;
  const leftMissing = leftValue === null || leftValue === undefined;
  const rightMissing = rightValue === null || rightValue === undefined;

  if (leftMissing && rightMissing) {
    return compareByName(left, right);
  }
  if (leftMissing) {
    return 1;
  }
  if (rightMissing) {
    return -1;
  }

  const delta =
    direction === "desc"
      ? Number(rightValue) - Number(leftValue)
      : Number(leftValue) - Number(rightValue);
  if (delta !== 0) {
    return delta;
  }

  return compareByName(left, right);
}

function compareByName(left, right) {
  return left.name.localeCompare(right.name, "da");
}

function partyDisplayName(partyName, partyShort) {
  if (partyName && partyShort) {
    return `${partyName} (${partyShort})`;
  }
  return partyName || partyShort || "Uden parti";
}

function setMeter(bar, value, toneTarget, metricKind) {
  if (!bar) {
    return;
  }

  const normalized = clampPercent(value);
  bar.style.width = `${normalized}%`;
  setMetricTone(toneTarget, value, metricKind);
}

function setMetricTone(element, value, metricKind) {
  if (!element) {
    return;
  }

  setStaticTone(element, metricTone(value, metricKind));
}

function setStaticTone(element, tone) {
  if (!element) {
    return;
  }

  element.classList.remove("tone-good", "tone-ok", "tone-warn", "tone-risk", "tone-neutral");
  element.classList.add(`tone-${tone}`);
}

function metricTone(value, metricKind) {
  if (value === null || value === undefined) {
    return "neutral";
  }

  if (metricKind === "loyalty") {
    if (value >= 95) {
      return "good";
    }
    if (value >= 85) {
      return "ok";
    }
    if (value >= 70) {
      return "warn";
    }
    return "risk";
  }

  if (metricKind === "attendance") {
    if (value >= 85) {
      return "good";
    }
    if (value >= 65) {
      return "ok";
    }
    if (value >= 40) {
      return "warn";
    }
    return "risk";
  }

  return "neutral";
}

function clampPercent(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(value)));
}
