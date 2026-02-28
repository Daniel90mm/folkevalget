const DiscoverApp = (() => {
  const state = {
    profiles: [],
    filteredProfiles: [],
    stats: null,
    query: "",
    partyFilter: "",
    committeeFilter: "",
    sortMode: "name",
  };

  const statsRoot = document.querySelector("[data-site-stats]");
  const searchInput = document.querySelector("#search-input");
  const partyFilter = document.querySelector("#party-filter");
  const committeeFilter = document.querySelector("#committee-filter");
  const sortSelect = document.querySelector("#sort-select");
  const resultCount = document.querySelector("#result-count");
  const cardGrid = document.querySelector("#discover-grid");
  const cardTemplate = document.querySelector("#discover-card-template");

  async function boot() {
    hydrateStateFromQuery();
    const { profiles, stats } = await window.Folkevalget.loadCatalogueData();
    state.profiles = profiles;
    state.stats = stats;

    populatePartyFilter(profiles);
    populateCommitteeFilter(profiles);
    syncControls();
    window.Folkevalget.renderStats(statsRoot, stats);
    bindEvents();
    applyFilters();
  }

  function hydrateStateFromQuery() {
    const params = new URLSearchParams(window.location.search);
    state.query = params.get("q") || "";
    state.partyFilter = params.get("party") || "";
    state.committeeFilter = params.get("committee") || "";
    state.sortMode = params.get("sort") || "name";
  }

  function syncControls() {
    searchInput.value = state.query;
    partyFilter.value = state.partyFilter;
    committeeFilter.value = state.committeeFilter;
    sortSelect.value = state.sortMode;
  }

  function bindEvents() {
    searchInput.addEventListener("input", (event) => {
      state.query = event.target.value;
      applyFilters();
    });

    partyFilter.addEventListener("change", (event) => {
      state.partyFilter = event.target.value;
      applyFilters();
    });

    committeeFilter.addEventListener("change", (event) => {
      state.committeeFilter = event.target.value;
      applyFilters();
    });

    sortSelect.addEventListener("change", (event) => {
      state.sortMode = event.target.value;
      applyFilters();
    });
  }

  function populatePartyFilter(profiles) {
    const parties = new Map();
    for (const profile of profiles) {
      const value = profile.party_short || profile.party;
      if (!value || parties.has(value)) {
        continue;
      }
      parties.set(value, window.Folkevalget.partyDisplayName(profile.party, profile.party_short));
    }

    for (const [value, label] of [...parties.entries()].sort((left, right) => left[1].localeCompare(right[1], "da"))) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      partyFilter.append(option);
    }
  }

  function populateCommitteeFilter(profiles) {
    const committees = new Map();
    for (const profile of profiles) {
      for (const committee of profile.committees || []) {
        if (!committees.has(committee.short_name)) {
          committees.set(committee.short_name, committee.name || committee.short_name);
        }
      }
    }

    for (const [value, name] of [...committees.entries()].sort((left, right) => left[1].localeCompare(right[1], "da"))) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${value} · ${name}`;
      committeeFilter.append(option);
    }
  }

  function applyFilters() {
    const rawQuery = state.query.trim().toLowerCase();
    const query = window.Folkevalget.normaliseText(state.query);

    state.filteredProfiles = state.profiles.filter((profile) => {
      const rawSearchable = [
        profile.name,
        profile.party,
        profile.party_short,
        profile.role,
        ...(profile.committees || []).map((committee) => `${committee.short_name} ${committee.name || ""}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const searchable = window.Folkevalget.normaliseText(rawSearchable);

      const partyValue = profile.party_short || profile.party || "";
      const matchesQuery = !rawQuery || searchable.includes(query) || rawSearchable.includes(rawQuery);
      const matchesParty = !state.partyFilter || partyValue === state.partyFilter;
      const matchesCommittee =
        !state.committeeFilter ||
        (profile.committees || []).some((committee) => committee.short_name === state.committeeFilter);

      return matchesQuery && matchesParty && matchesCommittee;
    });

    state.filteredProfiles.sort((left, right) => window.Folkevalget.compareProfiles(left, right, state.sortMode));

    renderCards();
    syncQueryString();
  }

  function syncQueryString() {
    const params = new URLSearchParams();
    if (state.query.trim()) {
      params.set("q", state.query.trim());
    }
    if (state.partyFilter) {
      params.set("party", state.partyFilter);
    }
    if (state.committeeFilter) {
      params.set("committee", state.committeeFilter);
    }
    if (state.sortMode && state.sortMode !== "name") {
      params.set("sort", state.sortMode);
    }
    const next = params.toString() ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState({}, "", next);
  }

  function renderCards() {
    cardGrid.innerHTML = "";

    if (state.filteredProfiles.length === 0) {
      cardGrid.innerHTML = '<div class="empty-state">Ingen profiler matcher filtrene.</div>';
      resultCount.textContent = "0 profiler";
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const profile of state.filteredProfiles) {
      const card = cardTemplate.content.firstElementChild.cloneNode(true);
      card.href = window.Folkevalget.buildProfileUrl(profile.id);

      card.querySelector("[data-card='party']").textContent = window.Folkevalget.partyDisplayName(
        profile.party,
        profile.party_short
      );
      card.querySelector("[data-card='party']").dataset.party = profile.party_short || "";
      card.querySelector("[data-card='name']").textContent = profile.name;
      card.querySelector("[data-card='role']").textContent = profile.role || "Folketingsmedlem";
      card.querySelector("[data-card='votes']").textContent =
        `${window.Folkevalget.formatNumber(profile.votes_total)} registrerede stemmer`;
      card.querySelector("[data-card='committees']").textContent =
        `${window.Folkevalget.formatNumber((profile.committees || []).length)} udvalg`;
      card.querySelector("[data-card='attendance-value']").textContent = window.Folkevalget.formatPercent(profile.attendance_pct);
      card.querySelector("[data-card='loyalty-value']").textContent = window.Folkevalget.formatPercent(profile.party_loyalty_pct);
      card.querySelector("[data-card='for']").textContent = `${window.Folkevalget.formatNumber(profile.votes_for)} for`;
      card.querySelector("[data-card='against']").textContent = `${window.Folkevalget.formatNumber(profile.votes_against)} imod`;

      setMeter(
        card.querySelector("[data-card='attendance-bar']"),
        card.querySelector("[data-card='attendance-meter']"),
        profile.attendance_pct,
        "attendance"
      );
      setMeter(
        card.querySelector("[data-card='loyalty-bar']"),
        card.querySelector("[data-card='loyalty-meter']"),
        profile.party_loyalty_pct,
        "loyalty"
      );

      window.Folkevalget.applyPhoto(
        card.querySelector("[data-card='photo']"),
        card.querySelector("[data-card='initials']"),
        profile.photo_url,
        profile.name
      );

      fragment.append(card);
    }

    cardGrid.append(fragment);
    resultCount.textContent = `${window.Folkevalget.formatNumber(state.filteredProfiles.length)} profiler`;
  }

  function setMeter(bar, container, value, kind) {
    const tone = window.Folkevalget.metricTone(value, kind);
    bar.style.width = `${window.Folkevalget.clampPercent(value)}%`;
    container.dataset.tone = tone;
  }

  return { boot };
})();

DiscoverApp.boot().catch((error) => {
  console.error(error);
  const grid = document.querySelector("#discover-grid");
  const resultCount = document.querySelector("#result-count");
  if (grid) {
    grid.innerHTML = '<div class="empty-state">Kunne ikke indlæse profiler.</div>';
  }
  if (resultCount) {
    resultCount.textContent = "Fejl ved indlæsning";
  }
});
