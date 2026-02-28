const state = {
  profiles: [],
  votesById: new Map(),
  filteredProfiles: [],
  selectedId: null,
  partyFilter: "",
  query: "",
  stats: null,
};

const siteBasePath = detectSiteBasePath();

const profileGrid = document.querySelector("#profile-grid");
const partyFilter = document.querySelector("#party-filter");
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
  const [profilesResult, votesResult, statsResult] = await Promise.allSettled([
    fetchJson("data/profiler.json"),
    fetchJson("data/afstemninger.json"),
    fetchJson("data/site_stats.json"),
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
  renderProfiles();

  if (profiles.length > 0) {
    selectProfile(profiles[0].id);
  }
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
}

function populatePartyFilter(profiles) {
  const parties = Array.from(
    new Set(
      profiles
        .map((profile) => profile.party_short || profile.party)
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right, "da"));

  for (const party of parties) {
    const option = document.createElement("option");
    option.value = party;
    option.textContent = party;
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

    card.querySelector(".party-pill").textContent = profile.party_short || profile.party || "Uden parti";
    card.querySelector(".profile-name").textContent = profile.name;
    card.querySelector(".profile-role").textContent =
      profile.role || profile.constituency || "Folketingsmedlem";
    card.querySelector(".profile-attendance").textContent = formatPercent(profile.attendance_pct);
    card.querySelector(".profile-loyalty").textContent = formatPercent(profile.party_loyalty_pct);

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

  detail.party.textContent = profile.party || "Uden parti";
  detail.name.textContent = profile.name;
  detail.role.textContent = profile.role || profile.constituency || "Folketingsmedlem";
  detail.attendance.textContent = formatPercent(profile.attendance_pct);
  detail.loyalty.textContent = formatPercent(profile.party_loyalty_pct);
  detail.votesFor.textContent = formatNumber(profile.votes_for);
  detail.votesAgainst.textContent = formatNumber(profile.votes_against);

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
    item.textContent = committee.short_name || committee.name;
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
    return "–";
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
