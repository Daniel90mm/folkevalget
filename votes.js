const CLOSE_VOTE_THRESHOLD_PCT = 10;

const VotesApp = (() => {
  const state = {
    profiles: [],
    profilesById: new Map(),
    votes: [],
    filteredVotes: [],
    selectedVoteId: null,
    query: "",
    partyFilter: "",
    sortMode: "date_desc",
    closeOnly: false,
    splitOnly: false,
  };

  const statsRoot = document.querySelector("[data-site-stats]");
  const voteSearch = document.querySelector("#vote-search");
  const voteSortSelect = document.querySelector("#vote-sort-select");
  const voteCloseOnly = document.querySelector("#vote-close-only");
  const voteSplitOnly = document.querySelector("#vote-split-only");
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
    state.sortMode = params.get("sort") || "date_desc";
    state.closeOnly = params.get("close") === "1";
    state.splitOnly = params.get("split") === "1";

    const rawVoteId = Number(params.get("id"));
    state.selectedVoteId = Number.isFinite(rawVoteId) && rawVoteId > 0 ? rawVoteId : null;
  }

  function syncControls() {
    voteSearch.value = state.query;
    voteSortSelect.value = state.sortMode;
    voteCloseOnly.checked = state.closeOnly;
    voteSplitOnly.checked = state.splitOnly;
  }

  function bindEvents() {
    voteSearch.addEventListener("input", (event) => {
      state.query = event.target.value;
      applyVoteFilter();
    });

    voteSortSelect.addEventListener("change", (event) => {
      state.sortMode = event.target.value;
      applyVoteFilter();
    });

    voteCloseOnly.addEventListener("change", (event) => {
      state.closeOnly = event.target.checked;
      applyVoteFilter();
    });

    voteSplitOnly.addEventListener("change", (event) => {
      state.splitOnly = event.target.checked;
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

    state.filteredVotes = state.votes
      .filter((vote) => {
        if (state.closeOnly && !isCloseVote(vote)) {
          return false;
        }
        if (state.splitOnly && !hasPartySplit(vote)) {
          return false;
        }

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
      })
      .sort(compareVotes);

    if (!state.filteredVotes.some((vote) => vote.afstemning_id === state.selectedVoteId)) {
      state.selectedVoteId = state.filteredVotes[0]?.afstemning_id ?? null;
      state.partyFilter = "";
    }

    renderVoteList();
    renderSelectedVote();
    syncQueryString();
  }

  function compareVotes(left, right) {
    if (state.sortMode === "close_first") {
      const delta = voteMarginSharePct(left) - voteMarginSharePct(right);
      if (delta !== 0) {
        return delta;
      }
      return compareVotesByDate(left, right);
    }

    if (state.sortMode === "split_first") {
      const splitDelta = Number(right.party_split_count || 0) - Number(left.party_split_count || 0);
      if (splitDelta !== 0) {
        return splitDelta;
      }
      const marginDelta = voteMarginSharePct(left) - voteMarginSharePct(right);
      if (marginDelta !== 0) {
        return marginDelta;
      }
      return compareVotesByDate(left, right);
    }

    return compareVotesByDate(left, right);
  }

  function compareVotesByDate(left, right) {
    const dateDelta = String(right.date || "").localeCompare(String(left.date || ""));
    if (dateDelta !== 0) {
      return dateDelta;
    }
    return Number(right.afstemning_id || 0) - Number(left.afstemning_id || 0);
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
    if (state.sortMode !== "date_desc") {
      params.set("sort", state.sortMode);
    }
    if (state.closeOnly) {
      params.set("close", "1");
    }
    if (state.splitOnly) {
      params.set("split", "1");
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
      renderVoteSignals(item.querySelector("[data-cell='signals']"), vote);
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
    renderVoteSignalsSummary(selectedVote);
    renderVoteContext(selectedVote);
    renderPartyFilter(selectedVote);
    renderVoteLists(selectedVote);
  }

  function renderVoteHeader(vote) {
    document.querySelector("#vote-detail-kicker").textContent = [vote.type || "Afstemning", vote.sag_number || null]
      .filter(Boolean)
      .join(" · ");

    document.querySelector("#vote-title").textContent = vote.sag_short_title || vote.sag_title || "Afstemning";

    const forCount = Number(vote.counts?.for || 0);
    const againstCount = Number(vote.counts?.imod || 0);
    document.querySelector("#vote-meta").textContent = [
      window.Folkevalget.formatDate(vote.date),
      vote.vedtaget ? "Forslaget blev vedtaget" : "Forslaget blev forkastet",
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

  function renderVoteSignalsSummary(vote) {
    const marginValue = document.querySelector("#vote-margin-value");
    const marginNote = document.querySelector("#vote-margin-note");
    const splitValue = document.querySelector("#vote-split-value");
    const splitNote = document.querySelector("#vote-split-note");

    const marginVotes = Number(vote.margin || 0);
    const marginShare = voteMarginSharePct(vote);
    if (voteDecisionTotal(vote) > 0) {
      marginValue.textContent = `${window.Folkevalget.formatNumber(marginVotes)} stemmer`;
      marginNote.textContent = isCloseVote(vote)
        ? `Tæt afstemning med ${formatShare(marginShare)} mellem ja og nej.`
        : `${formatShare(marginShare)} mellem ja og nej.`;
    } else {
      marginValue.textContent = "Ingen ja/nej-data";
      marginNote.textContent = "Afstemningen har ingen registrerede ja- og nej-stemmer i datasættet.";
    }

    const splitCount = Number(vote.party_split_count || 0);
    splitValue.textContent = `${window.Folkevalget.formatNumber(splitCount)} partier`;
    splitNote.textContent =
      splitCount > 0
        ? `${window.Folkevalget.formatNumber(splitCount)} parti${splitCount === 1 ? "" : "er"} havde intern uenighed.`
        : "Ingen registrerede partisplits i denne afstemning.";
  }

  function renderVoteContext(vote) {
    const notes = ["Partifilteret bruger partierne på afstemningstidspunktet."];
    if (isCloseVote(vote)) {
      notes.push("Afstemningen er markeret som tæt, fordi ja/nej-marginen er højst 10 procentpoint.");
    }
    if (hasPartySplit(vote)) {
      notes.push("Partisplit betyder, at mindst ét parti ikke stemte samlet i ja/nej-afstemningen.");
    }
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
    const visibleCounts = {
      for: participantIdsFor(vote, "for").length,
      imod: participantIdsFor(vote, "imod").length,
      fravaer: participantIdsFor(vote, "fravaer").length,
      hverken: participantIdsFor(vote, "hverken").length,
    };

    const filteredYes = enrichParticipants(participantIdsFor(vote, "for"), partyKeyByPersonId);
    const filteredNo = enrichParticipants(participantIdsFor(vote, "imod"), partyKeyByPersonId);

    document.querySelector("#vote-yes-title").textContent =
      `${window.Folkevalget.formatNumber(filteredYes.length)} stemte for`;
    document.querySelector("#vote-no-title").textContent =
      `${window.Folkevalget.formatNumber(filteredNo.length)} stemte imod`;

    const filterSummary = document.querySelector("#vote-filter-summary");
    if (state.partyFilter) {
      filterSummary.textContent =
        `${formatPartyLabel(state.partyFilter)}: ${window.Folkevalget.formatNumber(filteredYes.length)} for og ${window.Folkevalget.formatNumber(filteredNo.length)} imod. Grafen viser det samme udsnit.`;
    } else {
      filterSummary.textContent = "Viser alle registrerede ja- og nej-stemmer for denne afstemning.";
    }

    renderVoteDistribution(visibleCounts);
    renderParticipantList(document.querySelector("#vote-yes-list"), filteredYes);
    renderParticipantList(document.querySelector("#vote-no-list"), filteredNo);
  }

  function renderVoteDistribution(counts) {
    const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);

    for (const key of ["for", "imod", "fravaer", "hverken"]) {
      const value = Number(counts[key] || 0);
      const share = total > 0 ? (value / total) * 100 : 0;
      const segment = document.querySelector(`[data-segment='${key}']`);
      const stat = document.querySelector(`[data-distribution='${key}']`);

      if (segment) {
        segment.style.width = `${share}%`;
        segment.title = `${labelForGroup(key)}: ${window.Folkevalget.formatNumber(value)} (${formatShare(share)})`;
      }

      if (stat) {
        stat.querySelector("[data-value]").textContent = window.Folkevalget.formatNumber(value);
        stat.querySelector("[data-share]").textContent = formatShare(share);
      }
    }
  }

  function renderVoteSignals(root, vote) {
    root.innerHTML = "";
    if (isCloseVote(vote)) {
      root.append(buildSignalBadge("Tæt", "close"));
    }
    if (hasPartySplit(vote)) {
      const count = Number(vote.party_split_count || 0);
      root.append(buildSignalBadge(`${window.Folkevalget.formatNumber(count)} partisplit${count === 1 ? "" : "s"}`, "split"));
    }
  }

  function buildSignalBadge(label, tone) {
    const badge = document.createElement("span");
    badge.className = `vote-flag vote-flag-${tone}`;
    badge.textContent = label;
    return badge;
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
      const partyCode = shortPartyValue(participant.partyKey);

      row.href = window.Folkevalget.buildProfileUrl(participant.id);
      row.querySelector("[data-cell='party-code']").textContent = partyCode || "-";
      row.querySelector("[data-cell='party-code']").dataset.party = partyCode;
      row.querySelector("[data-cell='party-name']").textContent = fullPartyName(participant.partyKey);
      row.querySelector("[data-cell='name']").textContent = participant.name;
      row.querySelector("[data-cell='role']").textContent = participant.role;
      fragment.append(row);
    }

    root.append(fragment);
  }

  function voteDecisionTotal(vote) {
    return Number(vote.counts?.for || 0) + Number(vote.counts?.imod || 0);
  }

  function voteMarginSharePct(vote) {
    const total = voteDecisionTotal(vote);
    if (total === 0) {
      return Number.POSITIVE_INFINITY;
    }
    return (Math.abs(Number(vote.counts?.for || 0) - Number(vote.counts?.imod || 0)) / total) * 100;
  }

  function isCloseVote(vote) {
    return voteDecisionTotal(vote) > 0 && voteMarginSharePct(vote) <= CLOSE_VOTE_THRESHOLD_PCT;
  }

  function hasPartySplit(vote) {
    return Number(vote.party_split_count || 0) > 0;
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

  function fullPartyName(partyKey) {
    if (!partyKey) {
      return "Uden parti";
    }
    if (/^[A-ZÆØÅ]{1,4}$/u.test(partyKey)) {
      return window.Folkevalget.PARTY_NAMES[partyKey] || partyKey;
    }
    return partyKey;
  }

  function labelForGroup(key) {
    const labels = {
      for: "For",
      imod: "Imod",
      fravaer: "Fravær",
      hverken: "Hverken",
    };
    return labels[key] || key;
  }

  function formatShare(value) {
    if (!Number.isFinite(value)) {
      return "-";
    }
    return `${value.toFixed(1).replace(".", ",")} %`;
  }

  return { boot };
})();

VotesApp.boot().catch((error) => {
  console.error(error);
  const list = document.querySelector("#vote-list");
  const empty = document.querySelector("#vote-empty");
  if (list) {
    list.innerHTML = '<div class="panel-empty">Afstemningerne kunne ikke indlæses.</div>';
  }
  if (empty) {
    empty.classList.remove("hidden");
    empty.textContent = "Detaljer for afstemningen kunne ikke indlæses.";
  }
});
