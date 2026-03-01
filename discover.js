const DiscoverApp = (() => {
  const VALID_SORTS = new Set(["name", "attendance_desc", "attendance_asc"]);

  const state = {
    profiles: [],
    filteredProfiles: [],
    query: "",
    constituencyFilter: "",
    partyFilter: "",
    committeeFilter: "",
    sortMode: "name",
    mobileFiltersOpen: false,
  };

  const statsRoot = document.querySelector("[data-site-stats]");
  const searchInput = document.querySelector("#search-input");
  const constituencyFilter = document.querySelector("#constituency-filter");
  const partyFilter = document.querySelector("#party-filter");
  const committeeFilter = document.querySelector("#committee-filter");
  const sortSelect = document.querySelector("#sort-select");
  const resultCount = document.querySelector("#result-count");
  const cardGrid = document.querySelector("#discover-grid");
  const cardTemplate = document.querySelector("#discover-card-template");
  const filtersToggle = document.querySelector("#filters-toggle");
  const filtersPanel = document.querySelector("#discover-filters-panel");
  const filtersClose = document.querySelector("#filters-close");
  const activeFilters = document.querySelector("#active-filters");

  async function boot() {
    hydrateStateFromQuery();
    const { profiles, stats } = await window.Folkevalget.loadCatalogueData();
    state.profiles = profiles;

    populateConstituencyFilter(profiles);
    populatePartyFilter(profiles);
    populateCommitteeFilter(profiles);
    syncControls();
    syncFilterPanel();
    window.Folkevalget.renderStats(statsRoot, stats);
    bindEvents();
    applyFilters();
  }

  function hydrateStateFromQuery() {
    const params = new URLSearchParams(window.location.search);
    state.query = params.get("q") || "";
    state.constituencyFilter = params.get("storkreds") || "";
    state.partyFilter = params.get("party") || "";
    state.committeeFilter = params.get("committee") || "";
    const sortMode = params.get("sort") || "name";
    state.sortMode = VALID_SORTS.has(sortMode) ? sortMode : "name";
  }

  function syncControls() {
    searchInput.value = state.query;
    constituencyFilter.value = state.constituencyFilter;
    partyFilter.value = state.partyFilter;
    committeeFilter.value = state.committeeFilter;
    sortSelect.value = state.sortMode;
  }

  function bindEvents() {
    searchInput.addEventListener("input", (event) => {
      state.query = event.target.value;
      applyFilters();
    });

    constituencyFilter.addEventListener("change", (event) => {
      state.constituencyFilter = event.target.value;
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

    if (filtersToggle) {
      filtersToggle.addEventListener("click", () => {
        state.mobileFiltersOpen = !state.mobileFiltersOpen;
        syncFilterPanel();
      });
    }

    if (filtersClose) {
      filtersClose.addEventListener("click", () => {
        state.mobileFiltersOpen = false;
        syncFilterPanel();
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.mobileFiltersOpen) {
        state.mobileFiltersOpen = false;
        syncFilterPanel();
      }
    });

    activeFilters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-clear-filter]");
      if (!button) {
        return;
      }

      const filterKey = button.dataset.clearFilter;
      if (filterKey === "query") {
        state.query = "";
      }
      if (filterKey === "storkreds") {
        state.constituencyFilter = "";
      }
      if (filterKey === "party") {
        state.partyFilter = "";
      }
      if (filterKey === "committee") {
        state.committeeFilter = "";
      }

      syncControls();
      applyFilters();
    });
  }

  function populateConstituencyFilter(profiles) {
    const options = new Map();
    for (const profile of profiles) {
      if (!profile.storkreds || options.has(profile.storkreds)) {
        continue;
      }
      options.set(profile.storkreds, profile.storkreds);
    }

    for (const [value, label] of [...options.entries()].sort((left, right) => left[1].localeCompare(right[1], "da"))) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      constituencyFilter.append(option);
    }
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
        if (!committee.short_name || committees.has(committee.short_name)) {
          continue;
        }
        committees.set(committee.short_name, committee.name || committee.short_name);
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
        profile.storkreds,
        ...(profile.educations || []),
        ...(profile.occupations || []),
        ...(profile.constituency_history || []),
        ...(profile.committees || []).map((committee) => `${committee.short_name} ${committee.name || ""}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const searchable = window.Folkevalget.normaliseText(rawSearchable);

      const partyValue = profile.party_short || profile.party || "";
      const matchesQuery = !rawQuery || searchable.includes(query) || rawSearchable.includes(rawQuery);
      const matchesConstituency =
        !state.constituencyFilter || (profile.storkreds || "") === state.constituencyFilter;
      const matchesParty = !state.partyFilter || partyValue === state.partyFilter;
      const matchesCommittee =
        !state.committeeFilter ||
        (profile.committees || []).some((committee) => committee.short_name === state.committeeFilter);

      return matchesQuery && matchesConstituency && matchesParty && matchesCommittee;
    });

    state.filteredProfiles.sort((left, right) => window.Folkevalget.compareProfiles(left, right, state.sortMode));

    renderCards();
    renderActiveFilters();
    syncQueryString();
  }

  function syncQueryString() {
    const params = new URLSearchParams();
    if (state.query.trim()) {
      params.set("q", state.query.trim());
    }
    if (state.constituencyFilter) {
      params.set("storkreds", state.constituencyFilter);
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
      cardGrid.innerHTML = '<div class="empty-state">Ingen profiler matcher de valgte filtre.</div>';
      resultCount.textContent = "0 profiler";
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const profile of state.filteredProfiles) {
      const card = cardTemplate.content.firstElementChild.cloneNode(true);
      const link = card.querySelector("[data-card='link']");
      link.href = window.Folkevalget.buildProfileUrl(profile.id);
      link.textContent = profile.name;

      const partyBadge = card.querySelector("[data-card='party']");
      partyBadge.textContent = profile.party_short || profile.party || "UP";
      partyBadge.dataset.party = profile.party_short || "";

      card.dataset.party = profile.party_short || "";
      card.querySelector("[data-card='role']").textContent = profile.role || "Folketingsmedlem";
      card.querySelector("[data-card='constituency']").textContent = profile.storkreds || "Storkreds ikke angivet";
      card.querySelector("[data-card='attendance-value']").textContent = window.Folkevalget.formatPercent(profile.attendance_pct);
      card.querySelector("[data-card='votes-for']").textContent = window.Folkevalget.formatNumber(profile.votes_for);
      card.querySelector("[data-card='votes-against']").textContent = window.Folkevalget.formatNumber(profile.votes_against);
      card.querySelector("[data-card='committees']").textContent =
        `${window.Folkevalget.formatNumber((profile.committees || []).length)} udvalg`;

      renderContextTags(card.querySelector("[data-card='tags']"), profile);
      window.Folkevalget.applyPhoto(
        card.querySelector("[data-card='photo']"),
        card.querySelector("[data-card='initials']"),
        profile.photo_url,
        profile.name,
        window.Folkevalget.photoCreditText(profile)
      );

      fragment.append(card);
    }

    cardGrid.append(fragment);
    resultCount.textContent = `${window.Folkevalget.formatNumber(state.filteredProfiles.length)} profiler`;
  }

  function renderContextTags(root, profile) {
    root.innerHTML = "";
    for (const flag of window.Folkevalget.profileContextFlags(profile)) {
      const tag = document.createElement("span");
      tag.className = `context-tag context-tag-${flag.key}`;
      tag.textContent = flag.label;
      root.append(tag);
    }
  }

  function renderActiveFilters() {
    activeFilters.innerHTML = "";

    const filters = [
      state.query.trim() ? { key: "query", label: `Søg: ${state.query.trim()}` } : null,
      state.constituencyFilter ? { key: "storkreds", label: state.constituencyFilter } : null,
      state.partyFilter ? { key: "party", label: formatPartyLabel(state.partyFilter) } : null,
      state.committeeFilter ? { key: "committee", label: formatCommitteeLabel(state.committeeFilter) } : null,
    ].filter(Boolean);

    activeFilters.classList.toggle("hidden", filters.length === 0);

    for (const filter of filters) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "active-filter";
      button.dataset.clearFilter = filter.key;
      button.textContent = `${filter.label} ×`;
      activeFilters.append(button);
    }
  }

  function formatPartyLabel(value) {
    return findOptionLabel(partyFilter, value);
  }

  function formatCommitteeLabel(value) {
    return findOptionLabel(committeeFilter, value);
  }

  function findOptionLabel(select, value) {
    const option = [...select.options].find((entry) => entry.value === value);
    return option?.textContent || value;
  }

  function syncFilterPanel() {
    if (!filtersToggle || !filtersPanel) {
      return;
    }
    filtersToggle.setAttribute("aria-expanded", String(state.mobileFiltersOpen));
    filtersPanel.dataset.open = String(state.mobileFiltersOpen);
    document.body.classList.toggle("filters-open", state.mobileFiltersOpen);
  }

  return { boot };
})();

DiscoverApp.boot().catch((error) => {
  console.error(error);
  const grid = document.querySelector("#discover-grid");
  const resultCount = document.querySelector("#result-count");
  if (grid) {
    grid.innerHTML = '<div class="empty-state">Profilerne kunne ikke indlæses.</div>';
  }
  if (resultCount) {
    resultCount.textContent = "Fejl ved indlæsning";
  }
});
