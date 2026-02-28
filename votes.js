const VotesApp = (() => {
  const state = {
    profiles: [],
    profilesById: new Map(),
    votes: [],
    filteredVotes: [],
    selectedVoteId: null,
    query: "",
    partyFilter: "",
  };

  const statsRoot = document.querySelector("[data-site-stats]");
  const voteSearch = document.querySelector("#vote-search");
  const voteList = document.querySelector("#vote-list");
  const voteListTemplate = document.querySelector("#vote-list-item-template");
  const voterRowTemplate = document.querySelector("#voter-row-template");
  const voteResultCount = document.querySelector("#vote-result-count");
  const voteEmpty = document.querySelector("#vote-empty");
  const voteDetailContent = document.querySelector("#vote-detail-content");
  const votePartyFilter = document.querySelector("#vote-party-filter");
  const voteContext = document.querySelector("#vote-context");
  const voteSourceLink = document.querySelector("#vote-source-link");

  async function boot() {
    hydrateStateFromQuery();

    const [{ profiles, stats }, votes] = await Promise.all([
      window.Folkevalget.loadCatalogueData(),
      window.Folkevalget.loadVoteData(),
    ]);

    state.profiles = profiles;
    state.profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    state.votes = votes;

    window.Folkevalget.renderStats(statsRoot, stats);
    bindEvents();
    syncControls();
    applyVoteFilter();
  }

  function hydrateStateFromQuery() {
    const params = new URLSearchParams(window.location.search);
    state.query = params.get("q") || "";
    state.partyFilter = params.get("party") || "";

    const rawVoteId = Number(params.get("id"));
    state.selectedVoteId = Number.isFinite(rawVoteId) && rawVoteId > 0 ? rawVoteId : null;
  }

  function syncControls() {
    voteSearch.value = state.query;
  }

  function bindEvents() {
    voteSearch.addEventListener("input", (event) => {
      state.query = event.target.value;
      applyVoteFilter();
    });

    voteList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-vote-id]");
      if (!button) {
        return;
      }
      state.selectedVoteId = Number(button.dataset.voteId);
      renderVoteList();
      renderSelectedVote();
      syncQueryString();
    });

    votePartyFilter.addEventListener("change", (event) => {
      state.partyFilter = event.target.value;
      renderSelectedVote();
      syncQueryString();
    });
  }

  function applyVoteFilter() {
    const query = window.Folkevalget.normaliseText(state.query);

    state.filteredVotes = state.votes.filter((vote) => {
      if (!query) {
        return true;
      }

      const searchable = window.Folkevalget.normaliseText(
        [
          vote.sag_number,
          vote.sag_short_title,
          vote.sag_title,
          vote.type,
          vote.konklusion,
          vote.date,
        ]
          .filter(Boolean)
          .join(" ")
      );

      return searchable.includes(query);
    });

    if (!state.filteredVotes.some((vote) => vote.afstemning_id === state.selectedVoteId)) {
      state.selectedVoteId = state.filteredVotes[0]?.afstemning_id ?? null;
      state.partyFilter = "";
    }

    renderVoteList();
    renderSelectedVote();
    syncQueryString();
  }

  function syncQueryString() {
    const params = new URLSearchParams();
    if (state.query.trim()) {
      params.set("q", state.query.trim());
    }
    if (state.selectedVoteId) {
      params.set("id", String(state.selectedVoteId));
    }
    if (state.partyFilter) {
      params.set("party", state.partyFilter);
    }
    const next = params.toString() ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState({}, "", next);
  }

  function renderVoteList() {
    voteList.innerHTML = "";
    voteResultCount.textContent = `${window.Folkevalget.formatNumber(state.filteredVotes.length)} forslag`;

    if (state.filteredVotes.length === 0) {
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const vote of state.filteredVotes) {
      const item = voteListTemplate.content.firstElementChild.cloneNode(true);
      item.dataset.voteId = String(vote.afstemning_id);
      item.classList.toggle("active", vote.afstemning_id === state.selectedVoteId);
      item.querySelector("[data-cell='number']").textContent = vote.sag_number || `Afstemning ${vote.nummer || ""}`.trim();
      item.querySelector("[data-cell='date']").textContent = window.Folkevalget.formatDate(vote.date);
      item.querySelector("[data-cell='title']").textContent = vote.sag_short_title || vote.sag_title || "Afstemning";
      item.querySelector("[data-cell='for-count']").textContent =
        `${window.Folkevalget.formatNumber(vote.counts?.for)} for`;
      item.querySelector("[data-cell='against-count']").textContent =
        `${window.Folkevalget.formatNumber(vote.counts?.imod)} imod`;
      fragment.append(item);
    }

    voteList.append(fragment);
  }

  function renderSelectedVote() {
    const selectedVote = state.filteredVotes.find((vote) => vote.afstemning_id === state.selectedVoteId) || null;

    if (!selectedVote) {
      voteEmpty.classList.remove("hidden");
      voteDetailContent.classList.add("hidden");
      return;
    }

    voteEmpty.classList.add("hidden");
    voteDetailContent.classList.remove("hidden");

    document.title = `${selectedVote.sag_number || "Afstemning"} | Folkevalget`;
    renderVoteHeader(selectedVote);
    renderVoteMetrics(selectedVote);
    renderVoteContext(selectedVote);
    renderPartyFilter(selectedVote);
    renderVoteLists(selectedVote);
  }

  function renderVoteHeader(vote) {
    document.querySelector("#vote-detail-kicker").textContent = [
      vote.type || "Afstemning",
      vote.sag_number || null,
    ]
      .filter(Boolean)
      .join(" · ");

    document.querySelector("#vote-title").textContent = vote.sag_short_title || vote.sag_title || "Afstemning";

    const forCount = Number(vote.counts?.for || 0);
    const againstCount = Number(vote.counts?.imod || 0);
    document.querySelector("#vote-meta").textContent = [
      window.Folkevalget.formatDate(vote.date),
      vote.vedtaget ? "Forslaget blev vedtaget" : "Forslaget faldt eller blev forkastet",
      `${window.Folkevalget.formatNumber(forCount + againstCount)} ja/nej-stemmer`,
    ].join(" · ");

    const sourceUrl = window.Folkevalget.buildSagUrl(vote.sag_number, vote.date);
    if (sourceUrl) {
      voteSourceLink.href = sourceUrl;
      voteSourceLink.classList.remove("hidden");
    } else {
      voteSourceLink.classList.add("hidden");
      voteSourceLink.removeAttribute("href");
    }
  }

  function renderVoteMetrics(vote) {
    renderVoteMetric("for", vote.counts?.for);
    renderVoteMetric("against", vote.counts?.imod);
    renderVoteMetric("absent", vote.counts?.fravaer);
    renderVoteMetric("neither", vote.counts?.hverken);
  }

  function renderVoteMetric(key, value) {
    const metric = document.querySelector(`[data-vote-metric='${key}']`);
    metric.querySelector("[data-value]").textContent = window.Folkevalget.formatNumber(value);
  }

  function renderVoteContext(vote) {
    const notes = [
      "Partifilteret bruger partierne på afstemningstidspunktet.",
    ];

    if (vote.konklusion) {
      notes.push(vote.konklusion.trim());
    }
    if (vote.kommentar) {
      notes.push(vote.kommentar.trim());
    }

    voteContext.classList.toggle("hidden", notes.length === 0);
    voteContext.innerHTML = notes.map((note) => `<p>${note}</p>`).join("");
  }

  function renderPartyFilter(vote) {
    const previousValue = state.partyFilter;
    votePartyFilter.innerHTML = '<option value="">Alle partier</option>';

    const partyKeys = Object.keys(vote.vote_groups_by_party || {}).sort((left, right) =>
      formatPartyLabel(left).localeCompare(formatPartyLabel(right), "da")
    );

    for (const key of partyKeys) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = formatPartyLabel(key);
      votePartyFilter.append(option);
    }

    if (previousValue && partyKeys.includes(previousValue)) {
      votePartyFilter.value = previousValue;
    } else {
      state.partyFilter = "";
      votePartyFilter.value = "";
    }
  }

  function renderVoteLists(vote) {
    const partyKeyByPersonId = buildPartyLookup(vote);
    const yesIds = participantIdsFor(vote, "for");
    const noIds = participantIdsFor(vote, "imod");

    const filteredYes = enrichParticipants(yesIds, partyKeyByPersonId);
    const filteredNo = enrichParticipants(noIds, partyKeyByPersonId);

    document.querySelector("#vote-yes-title").textContent =
      `${window.Folkevalget.formatNumber(filteredYes.length)} stemte for`;
    document.querySelector("#vote-no-title").textContent =
      `${window.Folkevalget.formatNumber(filteredNo.length)} stemte imod`;

    const filterSummary = document.querySelector("#vote-filter-summary");
    if (state.partyFilter) {
      filterSummary.textContent =
        `${formatPartyLabel(state.partyFilter)}: ${window.Folkevalget.formatNumber(filteredYes.length)} for og ${window.Folkevalget.formatNumber(filteredNo.length)} imod.`;
    } else {
      filterSummary.textContent =
        `Viser alle registrerede ja- og nej-stemmer for denne afstemning.`;
    }

    renderParticipantList(document.querySelector("#vote-yes-list"), filteredYes);
    renderParticipantList(document.querySelector("#vote-no-list"), filteredNo);
  }

  function participantIdsFor(vote, groupKey) {
    if (state.partyFilter) {
      return vote.vote_groups_by_party?.[state.partyFilter]?.[groupKey] || [];
    }
    return vote.vote_groups?.[groupKey] || [];
  }

  function buildPartyLookup(vote) {
    const lookup = new Map();
    for (const [partyKey, groups] of Object.entries(vote.vote_groups_by_party || {})) {
      for (const ids of Object.values(groups)) {
        for (const personId of ids) {
          lookup.set(personId, partyKey);
        }
      }
    }
    return lookup;
  }

  function enrichParticipants(ids, partyKeyByPersonId) {
    return [...ids]
      .map((personId) => {
        const profile = state.profilesById.get(personId) || null;
        return {
          id: personId,
          name: profile?.name || `Ukendt medlem (${personId})`,
          role: profile?.role || "Folketingsmedlem",
          partyKey: partyKeyByPersonId.get(personId) || profile?.current_party_short || profile?.party_short || "Uden parti",
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, "da"));
  }

  function renderParticipantList(root, participants) {
    root.innerHTML = "";

    if (participants.length === 0) {
      root.innerHTML = '<div class="panel-empty">Ingen registrerede medlemmer i denne visning.</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const participant of participants) {
      const row = voterRowTemplate.content.firstElementChild.cloneNode(true);
      row.href = window.Folkevalget.buildProfileUrl(participant.id);
      row.querySelector("[data-cell='party']").textContent = formatPartyLabel(participant.partyKey);
      row.querySelector("[data-cell='party']").dataset.party = shortPartyValue(participant.partyKey);
      row.querySelector("[data-cell='name']").textContent = participant.name;
      row.querySelector("[data-cell='role']").textContent = participant.role;
      fragment.append(row);
    }

    root.append(fragment);
  }

  function formatPartyLabel(partyKey) {
    if (!partyKey) {
      return "Uden parti";
    }
    if (/^[A-ZÆØÅ]{1,4}$/u.test(partyKey)) {
      return window.Folkevalget.partyDisplayName(null, partyKey);
    }
    return partyKey;
  }

  function shortPartyValue(partyKey) {
    return /^[A-ZÆØÅ]{1,4}$/u.test(partyKey || "") ? partyKey : "";
  }

  return { boot };
})();

VotesApp.boot().catch((error) => {
  console.error(error);
  const voteList = document.querySelector("#vote-list");
  const voteEmpty = document.querySelector("#vote-empty");
  if (voteList) {
    voteList.innerHTML = '<div class="panel-empty">Kunne ikke indlæse afstemninger.</div>';
  }
  if (voteEmpty) {
    voteEmpty.classList.remove("hidden");
    voteEmpty.textContent = "Detaljer for afstemningen kunne ikke indlæses.";
  }
});
