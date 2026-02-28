const DiscoverApp = (() => {
  const state = {
    profiles: [],
    filteredProfiles: [],
    stats: null,
    query: "",
    constituencyFilter: "",
    partyFilter: "",
    committeeFilter: "",
    sortMode: "attendance_desc",
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

  async function boot() {
    hydrateStateFromQuery();
    const { profiles, stats } = await window.Folkevalget.loadCatalogueData();
    state.profiles = profiles;
    state.stats = stats;

    populateConstituencyFilter(profiles);
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
    state.constituencyFilter = params.get("storkreds") || "";
    state.partyFilter = params.get("party") || "";
    state.committeeFilter = params.get("committee") || "";
    state.sortMode = params.get("sort") || "attendance_desc";
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
    if (state.sortMode && state.sortMode !== "attendance_asc") {
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
      card.dataset.party = profile.party_short || "";

      card.querySelector("[data-card='party']").textContent = window.Folkevalget.partyDisplayName(
        profile.party,
        profile.party_short
      );
      card.querySelector("[data-card='party']").dataset.party = profile.party_short || "";
      card.querySelector("[data-card='name']").textContent = profile.name;
      card.querySelector("[data-card='role']").textContent = profile.role || "Folketingsmedlem";
      renderContextTags(card.querySelector("[data-card='tags']"), profile);
      card.querySelector("[data-card='constituency']").textContent = profile.storkreds || "–";
      card.querySelector("[data-card='votes']").textContent =
        profile.seniority_label || "–";
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
      setAttendanceAlert(card.querySelector("[data-card='attendance-alert']"), profile.attendance_pct);
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
        profile.name,
        window.Folkevalget.photoCreditText(profile)
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

  function setAttendanceAlert(node, value) {
    if (!node) {
      return;
    }

    const hasWarning = value !== null && value !== undefined && Number(value) < 30;
    node.classList.toggle("hidden", !hasWarning);
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
