const DEFAULT_CLOSE_VOTE_THRESHOLD_PCT = 10;
const MIN_CLOSE_VOTE_THRESHOLD_PCT = 0;
const MAX_CLOSE_VOTE_THRESHOLD_PCT = 100;

const SAG_TYPE_TEKST = {
  L:  "Lovforslag — forslag til en ny lov eller ændring af gældende lovgivning. Behandles normalt tre gange i Folketinget.",
  B:  "Beslutningsforslag — opfordring til regeringen om at handle på en bestemt måde. Ikke en lov, men et politisk signal.",
  V:  "Forslag til vedtagelse — en parlamentarisk hensigtserklæring. Har ikke lovkraft, men udtrykker Folketingets holdning.",
  LA: "Ændringsforslag til lovforslag (A-række) — konkret ændring foreslået under lovbehandlingen.",
  LB: "Ændringsforslag til lovforslag (B-række) — konkret ændring foreslået under lovbehandlingen.",
  LC: "Ændringsforslag til lovforslag (C-række) — konkret ændring foreslået under lovbehandlingen.",
};

const STEMME_TYPE_TEKST = {
  "Endelig vedtagelse": "Afgørende afstemning ved 3. behandling — her afgøres forslagets endelige skæbne.",
  "Ændringsforslag": "Afstemning om en specifik ændring til forslaget under behandlingen.",
  "Forslag til vedtagelse": "Afstemning om en parlamentarisk hensigtserklæring.",
};

const VotesApp = (() => {
  const VALID_SORTS = new Set(["date_desc", "passed_first", "failed_first", "close_first", "split_first", "emneord_asc"]);

  const state = {
    profiles: [],
    profilesById: new Map(),
    timelineSummariesBySagId: new Map(),
    timelineShardBySagId: new Map(),
    timelinesBySagId: new Map(),
    loadedTimelineShards: new Set(),
    timelineShardLoadingPromises: new Map(),
    voteDetailsById: new Map(),
    voteDetailLoadingById: new Map(),
    votes: [],
    filteredVotes: [],
    selectedVoteId: null,
    query: "",
    partyFilter: "",
    sortMode: "date_desc",
    closeOnly: false,
    closeThresholdPct: DEFAULT_CLOSE_VOTE_THRESHOLD_PCT,
    splitOnly: false,
    typeFilter: "",
    officialSagstype: "",
    officialSagsstatus: "",
    officialSagskategori: "",
    rfDocs: [],
    focusDetailRequested: false,
  };

  const statsRoot = document.querySelector("[data-site-stats]");
  const voteSearch = document.querySelector("#vote-search");
  const voteSortSelect = document.querySelector("#vote-sort-select");
  const voteTypeSelect = document.querySelector("#vote-type-select");
  const voteSagstypeSelect = document.querySelector("#vote-sagstype-select");
  const voteSagsstatusSelect = document.querySelector("#vote-sagsstatus-select");
  const voteSagskategoriSelect = document.querySelector("#vote-sagskategori-select");
  const voteCloseOnly = document.querySelector("#vote-close-only");
  const voteCloseThreshold = document.querySelector("#vote-close-threshold");
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
  const voteEmneordInline = document.querySelector("#vote-emneord-inline");
  const voteEmneordInlineList = document.querySelector("#vote-emneord-inline-list");
  const voteOriginCase = document.querySelector("#vote-origin-case");
  const voteResumeBody = document.querySelector("#vote-resume-body");
  const voteTimeline = document.querySelector("#vote-timeline");
  const voteTimelineScroll = document.querySelector("#vote-timeline-scroll");
  const voteTimelineList = document.querySelector("#vote-timeline-list");
  const voteTimelineSourceLink = document.querySelector("#vote-timeline-source-link");
  const voteCaseMeta = document.querySelector("#vote-case-meta");
  const voteRelatedCasesBlock = document.querySelector("#vote-related-cases-block");
  const voteRelatedCasesList = document.querySelector("#vote-related-cases-list");
  const voteCaseActorsBlock = document.querySelector("#vote-case-actors-block");
  const voteCaseActorsList = document.querySelector("#vote-case-actors-list");
  const voteTaxonomyBlock = document.querySelector("#vote-taxonomy-block");
  const voteTaxonomyList = document.querySelector("#vote-taxonomy-list");
  const voteLawFollowupBlock = document.querySelector("#vote-law-followup-block");
  const voteLawFollowupList = document.querySelector("#vote-law-followup-list");

  async function boot() {
    hydrateStateFromQuery();

    const [{ profiles, stats }, voteOverview, rfDocs, timelineIndex] = await Promise.all([
      window.Folkevalget.loadCatalogueData(),
      window.Folkevalget.loadVoteOverview(),
      fetch(window.Folkevalget.toSiteUrl("data/ft_dokumenter_rf.json"))
        .then((r) => r.ok ? r.json() : [])
        .catch(() => []),
      fetch(window.Folkevalget.toSiteUrl("data/sag_tidslinjer_index.json"))
        .then((r) => r.ok ? r.json() : [])
        .catch(() => []),
    ]);

    state.profiles = profiles;
    state.profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    state.votes = Array.isArray(voteOverview) ? voteOverview : [];
    state.rfDocs = Array.isArray(rfDocs) ? rfDocs : [];
    state.timelineSummariesBySagId = new Map();
    state.timelineShardBySagId = new Map();
    for (const entry of (Array.isArray(timelineIndex) ? timelineIndex : [])) {
      const sagId = Number(entry?.sag_id || 0);
      if (!Number.isFinite(sagId) || sagId <= 0) {
        continue;
      }
      state.timelineSummariesBySagId.set(sagId, entry);
      const shardKey = String(entry?.shard || "");
      if (shardKey) {
        state.timelineShardBySagId.set(sagId, shardKey);
      }
    }

    window.Folkevalget.renderStats(statsRoot, stats);
    populateOfficialTaxonomyFilters();
    bindEvents();
    syncControls();
    applyVoteFilter();
    scheduleVoteDetailsPreload();
  }

  function hydrateStateFromQuery() {
    const params = new URLSearchParams(window.location.search);
    state.query = params.get("q") || "";
    state.partyFilter = params.get("party") || "";
    const sortMode = params.get("sort") || "date_desc";
    state.sortMode = VALID_SORTS.has(sortMode) ? sortMode : "date_desc";
    state.closeOnly = params.get("close") === "1";
    state.closeThresholdPct = sanitiseCloseThresholdPct(params.get("close_margin"));
    state.splitOnly = params.get("split") === "1";
    state.typeFilter = params.get("type") || "";
    state.officialSagstype = params.get("sagstype") || "";
    state.officialSagsstatus = params.get("sagsstatus") || "";
    state.officialSagskategori = params.get("sagskategori") || "";

    const rawVoteId = Number(params.get("id"));
    state.selectedVoteId = Number.isFinite(rawVoteId) && rawVoteId > 0 ? rawVoteId : null;
  }

  function syncControls() {
    voteSearch.value = state.query;
    voteTypeSelect.value = state.typeFilter;
    if (voteSagstypeSelect) {
      const hasValue = optionExists(voteSagstypeSelect, state.officialSagstype);
      voteSagstypeSelect.value = hasValue ? state.officialSagstype : "";
      if (!hasValue) {
        state.officialSagstype = "";
      }
    }
    if (voteSagsstatusSelect) {
      const hasValue = optionExists(voteSagsstatusSelect, state.officialSagsstatus);
      voteSagsstatusSelect.value = hasValue ? state.officialSagsstatus : "";
      if (!hasValue) {
        state.officialSagsstatus = "";
      }
    }
    if (voteSagskategoriSelect) {
      const hasValue = optionExists(voteSagskategoriSelect, state.officialSagskategori);
      voteSagskategoriSelect.value = hasValue ? state.officialSagskategori : "";
      if (!hasValue) {
        state.officialSagskategori = "";
      }
    }
    voteSortSelect.value = state.sortMode;
    voteCloseOnly.checked = state.closeOnly;
    if (voteCloseThreshold) {
      voteCloseThreshold.value = String(state.closeThresholdPct);
    }
    voteSplitOnly.checked = state.splitOnly;
  }

  function bindEvents() {
    voteSearch.addEventListener("input", (event) => {
      state.query = event.target.value;
      applyVoteFilter();
    });

    voteTypeSelect.addEventListener("change", (event) => {
      state.typeFilter = event.target.value;
      applyVoteFilter();
    });

    if (voteSagstypeSelect) {
      voteSagstypeSelect.addEventListener("change", (event) => {
        state.officialSagstype = event.target.value;
        applyVoteFilter();
      });
    }

    if (voteSagsstatusSelect) {
      voteSagsstatusSelect.addEventListener("change", (event) => {
        state.officialSagsstatus = event.target.value;
        applyVoteFilter();
      });
    }

    if (voteSagskategoriSelect) {
      voteSagskategoriSelect.addEventListener("change", (event) => {
        state.officialSagskategori = event.target.value;
        applyVoteFilter();
      });
    }

    voteSortSelect.addEventListener("change", (event) => {
      state.sortMode = event.target.value;
      applyVoteFilter();
    });

    voteCloseOnly.addEventListener("change", (event) => {
      state.closeOnly = event.target.checked;
      applyVoteFilter();
    });

    if (voteCloseThreshold) {
      const syncThresholdFromInput = () => {
        state.closeThresholdPct = sanitiseCloseThresholdPct(voteCloseThreshold.value);
        voteCloseThreshold.value = String(state.closeThresholdPct);
      };

      voteCloseThreshold.addEventListener("change", () => {
        syncThresholdFromInput();
        applyVoteFilter();
      });

      voteCloseThreshold.addEventListener("blur", () => {
        syncThresholdFromInput();
      });
    }

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
      state.focusDetailRequested = true;
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

  function scheduleVoteDetailsPreload() {
    const preload = () => {
      if (!state.selectedVoteId) {
        return;
      }
      ensureVoteDetailLoaded(state.selectedVoteId)
        .then((detail) => {
          if (detail) {
            renderSelectedVote();
          }
        })
        .catch(() => {});
    };

    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(preload, { timeout: 2000 });
      return;
    }

    window.setTimeout(preload, 300);
  }

  function ensureVoteDetailLoaded(voteId) {
    const normalizedVoteId = Number(voteId || 0);
    if (!Number.isFinite(normalizedVoteId) || normalizedVoteId <= 0) {
      return Promise.resolve(null);
    }

    if (state.voteDetailsById.has(normalizedVoteId)) {
      return Promise.resolve(state.voteDetailsById.get(normalizedVoteId));
    }

    if (state.voteDetailLoadingById.has(normalizedVoteId)) {
      return state.voteDetailLoadingById.get(normalizedVoteId);
    }

    const detailPromise = window.Folkevalget.loadVoteDetailById(normalizedVoteId)
      .then((detail) => {
        if (detail && Number(detail?.afstemning_id || 0) > 0) {
          state.voteDetailsById.set(Number(detail.afstemning_id), detail);
        }
        state.voteDetailLoadingById.delete(normalizedVoteId);
        return detail || null;
      })
      .catch((error) => {
        state.voteDetailLoadingById.delete(normalizedVoteId);
        throw error;
      });

    state.voteDetailLoadingById.set(normalizedVoteId, detailPromise);
    return detailPromise;
  }

  function timelineSummaryBySagId(sagId) {
    return state.timelineSummariesBySagId.get(Number(sagId)) || null;
  }

  function timelineBySagId(sagId) {
    const normalizedSagId = Number(sagId || 0);
    return state.timelinesBySagId.get(normalizedSagId) || timelineSummaryBySagId(normalizedSagId);
  }

  function ensureTimelineLoaded(sagId) {
    const normalizedSagId = Number(sagId || 0);
    if (!Number.isFinite(normalizedSagId) || normalizedSagId <= 0) {
      return Promise.resolve(null);
    }

    if (state.timelinesBySagId.has(normalizedSagId)) {
      return Promise.resolve(state.timelinesBySagId.get(normalizedSagId));
    }

    const shardKey = String(state.timelineShardBySagId.get(normalizedSagId) || "");
    if (!shardKey) {
      return Promise.resolve(null);
    }

    if (state.loadedTimelineShards.has(shardKey)) {
      return Promise.resolve(state.timelinesBySagId.get(normalizedSagId) || null);
    }

    if (state.timelineShardLoadingPromises.has(shardKey)) {
      return state.timelineShardLoadingPromises.get(shardKey).then(() =>
        state.timelinesBySagId.get(normalizedSagId) || null
      );
    }

    const shardPromise = fetch(window.Folkevalget.toSiteUrl(`data/sag_tidslinjer_shards/${encodeURIComponent(shardKey)}.json`))
      .then((response) => (response.ok ? response.json() : []))
      .then((rows) => {
        for (const row of (Array.isArray(rows) ? rows : [])) {
          const rowSagId = Number(row?.sag_id || 0);
          if (!Number.isFinite(rowSagId) || rowSagId <= 0) {
            continue;
          }
          state.timelinesBySagId.set(rowSagId, row);
        }
        state.loadedTimelineShards.add(shardKey);
        state.timelineShardLoadingPromises.delete(shardKey);
        return state.timelinesBySagId.get(normalizedSagId) || null;
      })
      .catch((error) => {
        state.timelineShardLoadingPromises.delete(shardKey);
        throw error;
      });

    state.timelineShardLoadingPromises.set(shardKey, shardPromise);
    return shardPromise;
  }

  function mergeVoteWithDetails(vote) {
    if (!vote || !Number.isFinite(Number(vote.afstemning_id))) {
      return vote;
    }

    const details = state.voteDetailsById.get(Number(vote.afstemning_id));
    if (!details) {
      return vote;
    }

    return {
      ...vote,
      ...details,
    };
  }

  function hasParticipantDetails(vote) {
    const voteGroups = vote?.vote_groups;
    const voteGroupsByParty = vote?.vote_groups_by_party;
    const groupKeys = ["for", "imod", "fravaer", "hverken"];
    const hasStructuredGroups = groupKeys.every((key) => Array.isArray(voteGroups?.[key]));
    return hasStructuredGroups && Boolean(voteGroupsByParty && typeof voteGroupsByParty === "object");
  }

  function applyVoteFilter() {
    const normalisedQuery = window.Folkevalget.normaliseText(state.query);
    const tokens = normalisedQuery.split(/\s+/).filter(Boolean);

    state.filteredVotes = state.votes
      .map((vote) => ({
        vote,
        searchScore: scoreVoteSearch(vote, normalisedQuery, tokens),
      }))
      .filter(({ vote, searchScore }) => {
        if (state.closeOnly && !isCloseVote(vote, state.closeThresholdPct)) {
          return false;
        }
        if (state.splitOnly && !hasPartySplit(vote)) {
          return false;
        }
        if (state.typeFilter && classifyVoteType(vote) !== state.typeFilter) {
          return false;
        }
        const timeline = timelineBySagId(vote.sag_id);
        if (state.officialSagstype && !matchesTaxonomyFilter(state.officialSagstype, timeline?.sag_type)) {
          return false;
        }
        if (state.officialSagsstatus && !matchesTaxonomyFilter(state.officialSagsstatus, timeline?.sag_status)) {
          return false;
        }
        if (state.officialSagskategori && !matchesTaxonomyFilter(state.officialSagskategori, timeline?.sag_category)) {
          return false;
        }
        if (tokens.length > 0 && searchScore < 0) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        if (tokens.length > 0 && left.searchScore !== right.searchScore) {
          return right.searchScore - left.searchScore;
        }
        return compareVotes(left.vote, right.vote);
      })
      .map((entry) => entry.vote);

    if (!state.filteredVotes.some((vote) => vote.afstemning_id === state.selectedVoteId)) {
      state.selectedVoteId = state.filteredVotes[0]?.afstemning_id ?? null;
      state.partyFilter = "";
    }

    renderVoteList();
    renderSelectedVote();
    syncQueryString();
  }

  function compareVotes(left, right) {
    if (state.sortMode === "passed_first") {
      const outcomeDelta = compareOutcomePriority(left, right, true);
      if (outcomeDelta !== 0) {
        return outcomeDelta;
      }
      return compareVotesByDate(left, right);
    }

    if (state.sortMode === "failed_first") {
      const outcomeDelta = compareOutcomePriority(left, right, false);
      if (outcomeDelta !== 0) {
        return outcomeDelta;
      }
      return compareVotesByDate(left, right);
    }

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

    if (state.sortMode === "emneord_asc") {
      const emneordDelta = compareVotesByEmneord(left, right);
      if (emneordDelta !== 0) {
        return emneordDelta;
      }
      return compareVotesByDate(left, right);
    }

    return compareVotesByDate(left, right);
  }

  function compareOutcomePriority(left, right, outcomeFirst) {
    const leftMatches = left.vedtaget === outcomeFirst ? 1 : 0;
    const rightMatches = right.vedtaget === outcomeFirst ? 1 : 0;
    return rightMatches - leftMatches;
  }

  function compareVotesByDate(left, right) {
    const dateDelta = String(right.date || "").localeCompare(String(left.date || ""));
    if (dateDelta !== 0) {
      return dateDelta;
    }
    return Number(right.afstemning_id || 0) - Number(left.afstemning_id || 0);
  }

  function compareVotesByEmneord(left, right) {
    const leftLabel = votePrimaryEmneordLabel(left);
    const rightLabel = votePrimaryEmneordLabel(right);
    const leftHasLabel = Boolean(leftLabel);
    const rightHasLabel = Boolean(rightLabel);
    if (leftHasLabel && rightHasLabel) {
      const labelDelta = leftLabel.localeCompare(rightLabel, "da");
      if (labelDelta !== 0) {
        return labelDelta;
      }
      return String(left.sag_number || "").localeCompare(String(right.sag_number || ""), "da");
    }
    if (leftHasLabel) {
      return -1;
    }
    if (rightHasLabel) {
      return 1;
    }
    return 0;
  }

  function optionExists(select, value) {
    if (!select || !value) {
      return false;
    }
    return Array.from(select.options).some((option) => option.value === value);
  }

  function matchesTaxonomyFilter(expected, actual) {
    return String(actual || "").trim() === String(expected || "").trim();
  }

  function populateOfficialTaxonomyFilters() {
    if (!voteSagstypeSelect && !voteSagsstatusSelect && !voteSagskategoriSelect) {
      return;
    }

    const typeValues = new Set();
    const statusValues = new Set();
    const categoryValues = new Set();

    for (const timeline of state.timelineSummariesBySagId.values()) {
      const sagType = String(timeline?.sag_type || "").trim();
      const sagStatus = String(timeline?.sag_status || "").trim();
      const sagCategory = String(timeline?.sag_category || "").trim();
      if (sagType) {
        typeValues.add(sagType);
      }
      if (sagStatus) {
        statusValues.add(sagStatus);
      }
      if (sagCategory) {
        categoryValues.add(sagCategory);
      }
    }

    if (voteSagstypeSelect) {
      fillSimpleSelect(voteSagstypeSelect, "Alle", [...typeValues].sort((a, b) => a.localeCompare(b, "da")));
    }
    if (voteSagsstatusSelect) {
      fillSimpleSelect(voteSagsstatusSelect, "Alle", [...statusValues].sort((a, b) => a.localeCompare(b, "da")));
    }
    if (voteSagskategoriSelect) {
      fillSimpleSelect(voteSagskategoriSelect, "Alle", [...categoryValues].sort((a, b) => a.localeCompare(b, "da")));
    }
  }

  function fillSimpleSelect(select, allLabel, values) {
    const selected = select.value;
    select.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = allLabel;
    select.append(allOption);
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
    if (selected && optionExists(select, selected)) {
      select.value = selected;
    }
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
    if (state.closeThresholdPct !== DEFAULT_CLOSE_VOTE_THRESHOLD_PCT) {
      params.set("close_margin", String(state.closeThresholdPct));
    }
    if (state.splitOnly) {
      params.set("split", "1");
    }
    if (state.typeFilter) {
      params.set("type", state.typeFilter);
    }
    if (state.officialSagstype) {
      params.set("sagstype", state.officialSagstype);
    }
    if (state.officialSagsstatus) {
      params.set("sagsstatus", state.officialSagsstatus);
    }
    if (state.officialSagskategori) {
      params.set("sagskategori", state.officialSagskategori);
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
      const counts = effectiveCounts(vote);
      const item = voteListTemplate.content.firstElementChild.cloneNode(true);
      item.dataset.voteId = String(vote.afstemning_id);
      item.classList.toggle("active", vote.afstemning_id === state.selectedVoteId);
      item.querySelector("[data-cell='number']").textContent = vote.sag_number || `Afstemning ${vote.nummer || ""}`.trim();
      item.querySelector("[data-cell='date']").textContent = window.Folkevalget.formatDate(vote.date);
      item.querySelector("[data-cell='title']").textContent = vote.sag_short_title || vote.sag_title || "Afstemning";
      item.querySelector("[data-cell='for-count']").textContent =
        `${window.Folkevalget.formatNumber(counts.for)} for`;
      item.querySelector("[data-cell='against-count']").textContent =
        `${window.Folkevalget.formatNumber(counts.imod)} imod`;
      renderVoteSignals(item.querySelector("[data-cell='signals']"), vote);
      fragment.append(item);
    }

    voteList.append(fragment);
  }

  function renderSelectedVote() {
    const selectedOverviewVote = state.filteredVotes.find((vote) => vote.afstemning_id === state.selectedVoteId) || null;

    if (!selectedOverviewVote) {
      voteEmpty.classList.remove("hidden");
      voteDetailContent.classList.add("hidden");
      return;
    }
    const selectedVote = mergeVoteWithDetails(selectedOverviewVote);

    voteEmpty.classList.add("hidden");
    voteDetailContent.classList.remove("hidden");

    document.title = `${selectedVote.sag_number || "Afstemning"} | Folkevalget`;
    renderVoteHeader(selectedVote);
    renderVoteEmneordInline(selectedVote);
    renderVoteSignalsSummary(selectedVote);
    renderVoteContext(selectedVote);
    renderVoteTimeline(selectedVote);
    renderVoteCaseMeta(selectedVote);
    renderPartyFilter(selectedVote);
    renderVoteLists(selectedVote);

    if (!state.voteDetailsById.has(Number(selectedOverviewVote.afstemning_id || 0))) {
      ensureVoteDetailLoaded(selectedOverviewVote.afstemning_id)
        .then((detail) => {
          if (detail && state.selectedVoteId === selectedOverviewVote.afstemning_id) {
            renderSelectedVote();
          }
        })
        .catch(() => {});
    }

    if (!state.timelinesBySagId.has(Number(selectedVote.sag_id || 0))) {
      ensureTimelineLoaded(selectedVote.sag_id)
        .then((timeline) => {
          if (timeline && state.selectedVoteId === selectedOverviewVote.afstemning_id) {
            renderSelectedVote();
          }
        })
        .catch(() => {});
    }

    if (state.focusDetailRequested && voteDetailContent) {
      voteDetailContent.scrollIntoView({ behavior: "smooth", block: "start" });
      state.focusDetailRequested = false;
    }
  }

  function scoreVoteSearch(vote, normalisedQuery, tokens) {
    if (!tokens.length) {
      return 0;
    }

    const sagNumber = window.Folkevalget.normaliseText(vote.sag_number || "");
    const sagNumberCompact = compactVoteSearchText(sagNumber);
    const shortTitle = window.Folkevalget.normaliseText(vote.sag_short_title || "");
    const shortTitleCompact = compactVoteSearchText(shortTitle);
    const title = window.Folkevalget.normaliseText(vote.sag_title || "");
    const titleCompact = compactVoteSearchText(title);
    const type = window.Folkevalget.normaliseText(vote.type || "");
    const conclusion = window.Folkevalget.normaliseText(vote.konklusion || "");
    const dateText = window.Folkevalget.normaliseText(vote.date || "");
    const queryCompact = compactVoteSearchText(normalisedQuery);

    const searchable = [sagNumber, shortTitle, title, type, conclusion, dateText].join(" ");
    const searchableCompact = compactVoteSearchText(searchable);
    let score = 0;

    for (const token of tokens) {
      const tokenCompact = compactVoteSearchText(token);
      if (sagNumber === token) {
        score += 220;
        continue;
      }
      if (tokenCompact && sagNumberCompact === tokenCompact) {
        score += 215;
        continue;
      }
      if (sagNumber.startsWith(token)) {
        score += 120;
        continue;
      }
      if (tokenCompact && sagNumberCompact.startsWith(tokenCompact)) {
        score += 115;
        continue;
      }
      if (shortTitle.startsWith(token) || title.startsWith(token)) {
        score += 50;
        continue;
      }
      if (tokenCompact && (shortTitleCompact.startsWith(tokenCompact) || titleCompact.startsWith(tokenCompact))) {
        score += 46;
        continue;
      }
      if (searchable.includes(token)) {
        score += 20;
        continue;
      }
      if (tokenCompact.length >= 3 && searchableCompact.includes(tokenCompact)) {
        score += 18;
        continue;
      }
      return -1;
    }

    if (normalisedQuery && (shortTitle.startsWith(normalisedQuery) || title.startsWith(normalisedQuery))) {
      score += 70;
    }
    if (queryCompact && (shortTitleCompact.startsWith(queryCompact) || titleCompact.startsWith(queryCompact))) {
      score += 64;
    }
    if (normalisedQuery && sagNumber === normalisedQuery) {
      score += 300;
    }
    if (queryCompact && sagNumberCompact === queryCompact) {
      score += 280;
    }

    return score;
  }

  function buildKickerTooltipText(vote) {
    const prefix = (vote.sag_number || "").replace(/\s.*$/, "");
    const parts = [];
    if (SAG_TYPE_TEKST[prefix]) parts.push(SAG_TYPE_TEKST[prefix]);
    if (STEMME_TYPE_TEKST[vote.type]) parts.push(STEMME_TYPE_TEKST[vote.type]);
    return parts.join(" ");
  }

  function renderVoteHeader(vote) {
    const kickerLabel = [vote.type || "Afstemning", vote.sag_number || null].filter(Boolean).join(" · ");
    const tooltipText = buildKickerTooltipText(vote);
    const kicker = document.querySelector("#vote-detail-kicker");

    if (tooltipText) {
      const wrap = document.createElement("span");
      wrap.className = "tooltip-wrap";
      const trigger = document.createElement("span");
      trigger.className = "tooltip-trigger";
      trigger.tabIndex = 0;
      trigger.setAttribute("aria-label", "Om denne forslagstype");
      trigger.textContent = "ⓘ";
      const body = document.createElement("span");
      body.className = "tooltip-body";
      body.setAttribute("role", "tooltip");
      body.textContent = tooltipText;
      wrap.append(trigger, body);
      kicker.replaceChildren(kickerLabel, " ", wrap);
    } else {
      kicker.textContent = kickerLabel;
    }

    document.querySelector("#vote-title").textContent = vote.sag_short_title || vote.sag_title || "Afstemning";

    const counts = effectiveCounts(vote);
    const forCount = counts.for;
    const againstCount = counts.imod;
    document.querySelector("#vote-meta").textContent = [
      window.Folkevalget.formatDate(vote.date),
      vote.vedtaget ? "Forslaget blev vedtaget" : "Forslaget blev forkastet",
      `${window.Folkevalget.formatNumber(forCount + againstCount)} ja/nej-stemmer`,
    ].join(" · ");

    if (voteOriginCase) {
      const timeline = timelineBySagId(vote.sag_id);
      const relatedCases = Array.isArray(timeline?.related_cases) ? timeline.related_cases : [];
      const originCase =
        timeline?.fremsat_under?.sag_number
          ? timeline.fremsat_under
          : findFremsatUnderRelatedCase(relatedCases);
      if (originCase?.sag_number) {
        const originLink = window.Folkevalget.buildSagUrl(originCase.sag_number, vote.date);
        voteOriginCase.textContent = "";
        const label = document.createElement("span");
        label.textContent = "Fremsat under: ";
        voteOriginCase.append(label);
        if (originLink) {
          const link = document.createElement("a");
          link.href = originLink;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = `${originCase.sag_number} ${originCase.sag_short_title || originCase.sag_title || ""}`.trim();
          voteOriginCase.append(link);
        } else {
          const text = document.createElement("span");
          text.textContent = `${originCase.sag_number} ${originCase.sag_short_title || originCase.sag_title || ""}`.trim();
          voteOriginCase.append(text);
        }
        voteOriginCase.classList.remove("hidden");
      } else {
        voteOriginCase.classList.add("hidden");
        voteOriginCase.textContent = "";
      }
    }

    const resumeText = formatResumeText(vote.sag_resume);
    if (resumeText) {
      voteResumeBody.textContent = resumeText;
      voteResumeBody.classList.remove("hidden");
    } else {
      voteResumeBody.classList.add("hidden");
      voteResumeBody.textContent = "";
    }

    const sourceUrl = window.Folkevalget.buildSagUrl(vote.sag_number, vote.date);
    if (sourceUrl) {
      voteSourceLink.href = sourceUrl;
      voteSourceLink.classList.remove("hidden");
    } else {
      voteSourceLink.classList.add("hidden");
      voteSourceLink.removeAttribute("href");
    }
  }

  function renderVoteEmneordInline(vote) {
    if (!voteEmneordInline || !voteEmneordInlineList) {
      return;
    }

    const entries = emneordEntriesForVote(vote);
    if (entries.length === 0) {
      voteEmneordInline.classList.add("hidden");
      voteEmneordInlineList.textContent = "";
      return;
    }

    const visibleLabels = entries.slice(0, 4).map((entry) => formatEmneordEntry(entry));
    const hiddenCount = Math.max(0, entries.length - visibleLabels.length);
    const suffix = hiddenCount > 0 ? ` Â· +${hiddenCount} flere` : "";
    voteEmneordInlineList.textContent = `${visibleLabels.join(" Â· ")}${suffix}`;
    voteEmneordInline.classList.remove("hidden");
  }

  function renderVoteSignalsSummary(vote) {
    const marginValue = document.querySelector("#vote-margin-value");
    const marginNote = document.querySelector("#vote-margin-note");
    const splitValue = document.querySelector("#vote-split-value");
    const splitNote = document.querySelector("#vote-split-note");
    const splitParties = splitPartyLabels(vote);

    const counts = effectiveCounts(vote);
    const marginVotes = Math.abs(counts.for - counts.imod);
    const marginShare = voteMarginSharePct(vote);
    if (voteDecisionTotal(vote) > 0) {
      marginValue.textContent = `${window.Folkevalget.formatNumber(marginVotes)} stemmer`;
      marginNote.textContent = isCloseVote(vote, state.closeThresholdPct)
        ? `Tæt afstemning med ${formatShare(marginShare)} mellem ja og nej.`
        : `${formatShare(marginShare)} mellem ja og nej.`;
    } else {
      marginValue.textContent = "Ingen ja/nej-data";
      marginNote.textContent = "Afstemningen har ingen registrerede ja- og nej-stemmer i datasættet.";
    }

    const splitCount = Number(vote.party_split_count || 0);
    if (splitCount > 0 && mistakeVoteInSplitParty(vote)) {
      const wrap = document.createElement("span");
      wrap.className = "tooltip-wrap";
      const trigger = document.createElement("span");
      trigger.className = "tooltip-trigger";
      trigger.tabIndex = 0;
      trigger.setAttribute("aria-label", "Mulig fejlstemme");
      trigger.textContent = "ⓘ";
      const body = document.createElement("span");
      body.className = "tooltip-body";
      body.setAttribute("role", "tooltip");
      body.textContent = "Et parti i dette split har en registreret fejlstemme. Splittet kan helt eller delvist skyldes en fejl frem for reel uenighed — se kommentaren nedenfor.";
      wrap.append(trigger, body);
      splitValue.replaceChildren(`${window.Folkevalget.formatNumber(splitCount)} partier `, wrap);
    } else {
      splitValue.textContent = `${window.Folkevalget.formatNumber(splitCount)} partier`;
    }
    splitNote.textContent = describeSplitParties(splitParties, splitCount);
  }

  function renderVoteContext(vote) {
    const notes = [];
    const splitParties = splitPartyLabels(vote);

    if (state.partyFilter) {
      notes.push({
        text: "Partifilteret bruger partierne på afstemningstidspunktet.",
      });
    }

    if (isCloseVote(vote, state.closeThresholdPct)) {
      notes.push({
        text: `Afstemningen er markeret som tæt, fordi ja/nej-marginen er højst ${state.closeThresholdPct} procentpoint.`,
      });
    }

    if (splitParties.length > 0) {
      notes.push({
        text: `Partisplit i denne afstemning: ${formatTextList(splitParties)}.`,
      });
    }

    if (effectiveCountSource(vote) === "konklusion") {
      notes.push({
        text: "Ja/nej-tallene kommer fra sagens konklusion. Individuelle stemmer er ikke registreret i ODA for denne afstemning.",
      });
    }

    if (vote.konklusion) {
      notes.push({
        text: vote.konklusion.trim(),
      });
    }

    if (vote.kommentar) {
      notes.push({
        text: vote.kommentar.trim(),
        className: isMistakeVoteComment(vote.kommentar) ? "context-note-emphasis" : "",
      });
    }

    voteContext.classList.toggle("hidden", notes.length === 0);
    voteContext.replaceChildren();

    for (const note of notes) {
      const paragraph = document.createElement("p");
      paragraph.textContent = note.text;
      if (note.className) {
        paragraph.className = note.className;
      }
      voteContext.append(paragraph);
    }
  }

  function renderVoteTimeline(vote) {
    if (!voteTimeline || !voteTimelineList || !voteTimelineSourceLink) {
      return;
    }

    const timeline = state.timelinesBySagId.get(Number(vote.sag_id));
    const steps = Array.isArray(timeline?.steps) ? timeline.steps : [];
    const caseDocuments = Array.isArray(timeline?.documents) ? timeline.documents : [];
    const relatedCases = Array.isArray(timeline?.related_cases) ? timeline.related_cases : [];

    if (steps.length === 0 && caseDocuments.length === 0) {
      voteTimeline.classList.add("hidden");
      voteTimelineList.replaceChildren();
      return;
    }

    const timelineItems = steps.map((step) => ({
      ...step,
      documents: Array.isArray(step.documents) ? [...step.documents] : [],
      agenda_items: Array.isArray(step.agenda_items) ? [...step.agenda_items] : [],
    }));

    const originCase = findFremsatUnderRelatedCase(relatedCases);
    if (originCase) {
      const fremsaettelseIndex = timelineItems.findIndex((item) => isFremsaettelseStep(item));
      if (fremsaettelseIndex >= 0) {
        timelineItems[fremsaettelseIndex].origin_case = originCase;
      }
    }

    const seenStepDocumentUrls = new Set();
    for (const step of timelineItems) {
      const stepDocuments = Array.isArray(step.documents) ? step.documents : [];
      for (const doc of stepDocuments) {
        if (doc?.url) {
          seenStepDocumentUrls.add(doc.url);
        }
      }
    }

    const extraDocsByDate = new Map();
    const undatedExtraDocs = [];
    for (const doc of caseDocuments) {
      if (!doc?.url || seenStepDocumentUrls.has(doc.url)) {
        continue;
      }

      if (isIsoDate(doc.date)) {
        const dateKey = String(doc.date);
        if (!extraDocsByDate.has(dateKey)) {
          extraDocsByDate.set(dateKey, []);
        }
        extraDocsByDate.get(dateKey).push(doc);
      } else {
        undatedExtraDocs.push(doc);
      }
    }

    for (const step of timelineItems) {
      if (!isIsoDate(step.date) || !extraDocsByDate.has(step.date)) {
        continue;
      }
      step.documents.push(...extraDocsByDate.get(step.date));
      extraDocsByDate.delete(step.date);
    }

    if (undatedExtraDocs.length > 0 && timelineItems.length > 0) {
      timelineItems[timelineItems.length - 1].documents.push(...undatedExtraDocs);
    }

    const supplementalItems = Array.from(extraDocsByDate.entries())
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([date, documents]) => ({
        date,
        title: "Dokumenter",
        type: null,
        status: null,
        vote_ids: [],
        documents,
        agenda_items: [],
      }));

    timelineItems.push(...supplementalItems);
    timelineItems.sort((left, right) => {
      const leftDate = isIsoDate(left.date) ? String(left.date) : "9999-12-31";
      const rightDate = isIsoDate(right.date) ? String(right.date) : "9999-12-31";
      const dateDelta = leftDate.localeCompare(rightDate);
      if (dateDelta !== 0) {
        return dateDelta;
      }
      const leftIsStep = Number((left.vote_ids || []).length) > 0 || Boolean(left.type);
      const rightIsStep = Number((right.vote_ids || []).length) > 0 || Boolean(right.type);
      return Number(rightIsStep) - Number(leftIsStep);
    });
    const activeStepIndex = findLatestTimelineIndex(timelineItems);

    voteTimeline.classList.remove("hidden");
    const fragment = document.createDocumentFragment();

    for (const [index, step] of timelineItems.entries()) {
      const item = document.createElement("li");
      item.className = "vote-timeline-step";
      const voteIds = Array.isArray(step.vote_ids) ? step.vote_ids : [];
      if (index === activeStepIndex) {
        item.classList.add("is-active");
      }

      const point = document.createElement("span");
      point.className = "vote-timeline-step-point";
      item.append(point);

      const card = document.createElement("article");
      card.className = "vote-timeline-step-card";

      const dateLabel = document.createElement("p");
      dateLabel.className = "vote-timeline-step-date";
      dateLabel.textContent = step.date ? window.Folkevalget.formatDate(step.date) : "Uden dato";

      const titleText = step.title || step.type || "Sagstrin";
      const title = document.createElement("h3");
      title.className = "vote-timeline-step-title";
      title.textContent = titleText;
      card.append(dateLabel, title);

      const statusParts = buildTimelineStatusParts(step, titleText);
      if (statusParts.length > 0) {
        const statusText = document.createElement("p");
        statusText.className = "vote-timeline-step-meta";
        statusText.textContent = statusParts.join(" · ");
        card.append(statusText);
      }

      const agendaItems = Array.isArray(step.agenda_items) ? step.agenda_items : [];
      if (agendaItems.length > 0) {
        const agendaSummary = buildAgendaSummaryLine(agendaItems[0]);
        if (agendaSummary) {
          const agendaText = document.createElement("p");
          agendaText.className = "vote-timeline-step-meta";
          agendaText.textContent = agendaSummary;
          card.append(agendaText);
        }
      }

      const links = document.createElement("div");
      links.className = "vote-timeline-step-links";
      if (step.origin_case?.sag_number) {
        const link = document.createElement("a");
        link.className = "vote-timeline-link";
        link.textContent = `Fremsat under ${buildRelatedCaseLabel(step.origin_case)}`;
        const originCaseUrl = window.Folkevalget.buildSagUrl(step.origin_case.sag_number, step.date || vote.date);
        if (originCaseUrl) {
          link.href = originCaseUrl;
          link.target = "_blank";
          link.rel = "noreferrer";
        }
        links.append(link);
      }
      if (voteIds.length > 0) {
        for (const voteId of voteIds.slice(0, 4)) {
          const link = document.createElement("a");
          link.className = "vote-timeline-link";
          link.href = window.Folkevalget.buildVoteUrl(voteId);
          link.textContent = `Afstemning ${voteId}`;
          links.append(link);
        }
      }

      const meetingAgendaUrl = agendaItems[0]?.meeting?.agenda_url || null;
      if (meetingAgendaUrl) {
        const agendaLink = document.createElement("a");
        agendaLink.className = "vote-timeline-link";
        agendaLink.href = meetingAgendaUrl;
        agendaLink.target = "_blank";
        agendaLink.rel = "noreferrer";
        agendaLink.textContent = "Åbn mødedagsorden";
        links.append(agendaLink);
      }

      const stepDocuments = Array.isArray(step.documents) ? step.documents : [];
      if (stepDocuments.length > 0) {
        for (const doc of stepDocuments.slice(0, 6)) {
          if (!doc?.url) {
            continue;
          }
          const docWrap = document.createElement("div");
          docWrap.className = "vote-timeline-link-group";
          const link = document.createElement("a");
          link.className = "vote-timeline-link";
          link.href = doc.url;
          link.target = "_blank";
          link.rel = "noreferrer";
          const docLabel = doc.title || doc.number || `Dokument ${doc.document_id || ""}`.trim();
          const docMeta = [];
          if (isIsoDate(doc.date)) {
            docMeta.push(window.Folkevalget.formatDate(doc.date));
          }
          if (doc.variant_code) {
            docMeta.push(`Tillæg ${doc.variant_code}`);
          }
          if (doc.is_omtryk) {
            const omtrykLabel = formatOmtrykLabel(doc.omtryk);
            docMeta.push(omtrykLabel || "Omtryk");
          }
          const omtrykReason = formatOmtrykReason(doc.omtryk);
          if (omtrykReason) {
            link.title = `Omtryk: ${omtrykReason}`;
          }
          link.textContent = docMeta.length > 0 ? `${docLabel} (${docMeta.join(" · ")})` : docLabel;
          docWrap.append(link);

          const docTaxonomyLine = buildDocumentTaxonomyLine(doc);
          if (docTaxonomyLine) {
            const taxonomyLine = document.createElement("p");
            taxonomyLine.className = "vote-meta-subline";
            taxonomyLine.textContent = docTaxonomyLine;
            docWrap.append(taxonomyLine);
          }

          const questionChainLine = buildDocumentQuestionChainLine(doc);
          if (questionChainLine) {
            const questionLine = document.createElement("p");
            questionLine.className = "vote-meta-subline";
            questionLine.textContent = questionChainLine;
            docWrap.append(questionLine);
          }

          const docActorsLine = buildDocumentActorsLine(doc);
          if (docActorsLine) {
            const actorLine = document.createElement("p");
            actorLine.className = "vote-meta-subline";
            actorLine.textContent = docActorsLine;
            docWrap.append(actorLine);
          }

          links.append(docWrap);
        }
      }

      if (links.childElementCount > 0) {
        card.append(links);
      }

      item.append(card);
      fragment.append(item);
    }

    voteTimelineList.replaceChildren(fragment);
    if (voteTimelineScroll && activeStepIndex >= 0) {
      const activeNode = voteTimelineList.children[activeStepIndex];
      if (activeNode && typeof activeNode.scrollIntoView === "function") {
        activeNode.scrollIntoView({ block: "nearest", inline: "center" });
      }
    }

    const timelineSourceUrl = window.Folkevalget.buildSagUrl(timeline.sag_number || vote.sag_number, vote.date);
    if (timelineSourceUrl) {
      voteTimelineSourceLink.href = timelineSourceUrl;
      voteTimelineSourceLink.classList.remove("hidden");
    } else {
      voteTimelineSourceLink.classList.add("hidden");
      voteTimelineSourceLink.removeAttribute("href");
    }
  }

  function renderVoteCaseMeta(vote) {
    if (
      !voteCaseMeta ||
      !voteRelatedCasesBlock ||
      !voteRelatedCasesList ||
      !voteCaseActorsBlock ||
      !voteCaseActorsList ||
      !voteTaxonomyBlock ||
      !voteTaxonomyList ||
      !voteLawFollowupBlock ||
      !voteLawFollowupList
    ) {
      return;
    }

    const timeline = state.timelinesBySagId.get(Number(vote.sag_id)) || null;
    const relatedCases = Array.isArray(timeline?.related_cases) ? timeline.related_cases : [];
    const visibleRelatedCases = relatedCases.filter((relatedCase) => !isFremsatUnderRelatedCase(relatedCase));

    const relatedFragment = document.createDocumentFragment();
    for (const relatedCase of visibleRelatedCases) {
      const item = document.createElement("li");
      const relationText = Array.isArray(relatedCase.relations) ? relatedCase.relations.join(", ") : "";
      const caseText = buildRelatedCaseLabel(relatedCase);
      const caseUrl = window.Folkevalget.buildSagUrl(relatedCase.sag_number, vote.date);
      if (caseUrl) {
        const link = document.createElement("a");
        link.textContent = caseText;
        link.href = caseUrl;
        link.target = "_blank";
        link.rel = "noreferrer";
        item.append(link);
      } else {
        const text = document.createElement("span");
        text.textContent = caseText;
        item.append(text);
      }
      if (relationText) {
        const meta = document.createElement("p");
        meta.className = "vote-meta-subline";
        meta.textContent = relationText;
        item.append(meta);
      }
      relatedFragment.append(item);
    }
    voteRelatedCasesList.replaceChildren(relatedFragment);
    voteRelatedCasesBlock.classList.toggle("hidden", visibleRelatedCases.length === 0);

    const caseActors = Array.isArray(timeline?.actors) ? timeline.actors : [];
    const caseActorItems = caseActors.filter((entry) => String(entry?.role || "").trim() || String(entry?.name || "").trim());
    const caseActorFragment = document.createDocumentFragment();
    for (const actor of caseActorItems) {
      const item = document.createElement("li");
      const primary = document.createElement("span");
      const roleText = String(actor.role || "").trim();
      const actorText = String(actor.name || "").trim();
      const actorType = String(actor.type || "").trim();
      if (roleText && actorText) {
        primary.textContent = `${roleText}: ${actorText}`;
      } else {
        primary.textContent = roleText || actorText || "Ukendt aktør";
      }
      item.append(primary);
      if (actorType && actorType.toLowerCase() !== "person") {
        const meta = document.createElement("p");
        meta.className = "vote-meta-subline";
        meta.textContent = actorType;
        item.append(meta);
      }
      caseActorFragment.append(item);
    }
    voteCaseActorsList.replaceChildren(caseActorFragment);
    voteCaseActorsBlock.classList.toggle("hidden", caseActorItems.length === 0);

    const taxonomyEntries = [
      { label: "Sagstype", value: timeline?.sag_type || null },
      { label: "Sagsstatus", value: timeline?.sag_status || null },
      { label: "Sagskategori", value: timeline?.sag_category || null },
    ].filter((entry) => String(entry.value || "").trim());
    const taxonomyFragment = document.createDocumentFragment();
    for (const entry of taxonomyEntries) {
      const item = document.createElement("li");
      const value = document.createElement("span");
      value.textContent = `${entry.label}: ${entry.value}`;
      item.append(value);
      taxonomyFragment.append(item);
    }
    voteTaxonomyList.replaceChildren(taxonomyFragment);
    voteTaxonomyBlock.classList.toggle("hidden", taxonomyEntries.length === 0);

    const lawFollowup = timeline?.law_followup || {};
    const lawEntries = [];
    if (lawFollowup.law_number) {
      lawEntries.push({
        label: "Lovnummer",
        value: String(lawFollowup.law_number),
      });
    }
    if (lawFollowup.law_number_date) {
      lawEntries.push({
        label: "Lovnummerdato",
        value: window.Folkevalget.formatDate(lawFollowup.law_number_date),
      });
    }
    if (lawFollowup.decision_date) {
      lawEntries.push({
        label: "Afgørelsesdato",
        value: window.Folkevalget.formatDate(lawFollowup.decision_date),
      });
    }
    if (lawFollowup.decision_text) {
      lawEntries.push({
        label: "Afgørelse",
        value: String(lawFollowup.decision_text),
      });
    }
    if (lawFollowup.retsinformation_url) {
      lawEntries.push({
        label: "Retsinformation",
        value: String(lawFollowup.retsinformation_url),
        isLink: true,
      });
    }
    const lawFragment = document.createDocumentFragment();
    for (const entry of lawEntries) {
      const item = document.createElement("li");
      if (entry.isLink) {
        const link = document.createElement("a");
        link.href = entry.value;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = `${entry.label}: Åbn`;
        item.append(link);
      } else {
        const value = document.createElement("span");
        value.textContent = `${entry.label}: ${entry.value}`;
        item.append(value);
      }
      lawFragment.append(item);
    }
    voteLawFollowupList.replaceChildren(lawFragment);
    voteLawFollowupBlock.classList.toggle("hidden", lawEntries.length === 0);

    const hasMeta =
      visibleRelatedCases.length > 0 ||
      caseActorItems.length > 0 ||
      taxonomyEntries.length > 0 ||
      lawEntries.length > 0;
    voteCaseMeta.classList.toggle("hidden", !hasMeta);
  }

  function buildAgendaSummaryLine(agendaItem) {
    if (!agendaItem || typeof agendaItem !== "object") {
      return "";
    }
    const meeting = agendaItem.meeting || {};
    const parts = [];
    const meetingLabel = meeting.number ? `Møde ${meeting.number}` : "Møde";
    if (meeting.date) {
      parts.push(`${meetingLabel} ${window.Folkevalget.formatDate(meeting.date)}`);
    } else if (meeting.number) {
      parts.push(meetingLabel);
    }
    if (meeting.type) {
      parts.push(meeting.type);
    }
    if (meeting.status) {
      parts.push(meeting.status);
    }
    if (agendaItem.agenda_number) {
      parts.push(`Punkt ${agendaItem.agenda_number}`);
    }
    return parts.join(" · ");
  }

  function buildDocumentTaxonomyLine(doc) {
    const parts = [];
    if (doc.document_type) {
      parts.push(`Type: ${doc.document_type}`);
    }
    if (doc.document_status) {
      parts.push(`Status: ${doc.document_status}`);
    }
    if (doc.document_category) {
      parts.push(`Kategori: ${doc.document_category}`);
    }
    return parts.join(" · ");
  }

  function buildDocumentQuestionChainLine(doc) {
    const chain = doc?.question_chain || {};
    const askers = Array.isArray(chain.askers) ? chain.askers : [];
    const responders = Array.isArray(chain.responders) ? chain.responders : [];
    const parts = [];
    if (askers.length > 0) {
      parts.push(`Spørger: ${formatNamesCompact(askers)}`);
    }
    if (responders.length > 0) {
      parts.push(`Svarer: ${formatNamesCompact(responders)}`);
    }
    return parts.join(" · ");
  }

  function buildDocumentActorsLine(doc) {
    const actors = Array.isArray(doc?.document_actors) ? doc.document_actors : [];
    const labels = actors
      .map((entry) => {
        const role = String(entry?.role || "").trim();
        const name = String(entry?.name || "").trim();
        if (role && name) {
          return `${role}: ${name}`;
        }
        return role || name;
      })
      .filter(Boolean);
    if (labels.length === 0) {
      return "";
    }
    return `Aktører: ${formatNamesCompact(labels)}`;
  }

  function formatNamesCompact(items) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (list.length === 0) {
      return "";
    }
    if (list.length <= 2) {
      return list.join(" og ");
    }
    return `${list.slice(0, 2).join(", ")} (+${list.length - 2})`;
  }

  function renderPartyFilter(vote) {
    if (!hasParticipantDetails(vote)) {
      votePartyFilter.innerHTML = '<option value="">Alle partier</option>';
      votePartyFilter.value = "";
      votePartyFilter.disabled = true;
      state.partyFilter = "";
      return;
    }

    votePartyFilter.disabled = false;
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
    const counts = effectiveCounts(vote);
    const participantDetailsReady = hasParticipantDetails(vote);
    const hasIndividualVotes = hasIndividualVoteRows(vote);
    const noDecisionData = voteDecisionTotal(vote) === 0 && !hasIndividualVotes;
    const participantCounts = {
      for: participantIdsFor(vote, "for").length,
      imod: participantIdsFor(vote, "imod").length,
      fravaer: participantIdsFor(vote, "fravaer").length,
      hverken: participantIdsFor(vote, "hverken").length,
    };
    const visibleCounts = hasIndividualVotes
      ? participantCounts
      : {
        for: counts.for,
        imod: counts.imod,
        fravaer: counts.fravaer,
        hverken: counts.hverken,
      };

    const filteredYes = enrichParticipants(participantIdsFor(vote, "for"), partyKeyByPersonId);
    const filteredNo = enrichParticipants(participantIdsFor(vote, "imod"), partyKeyByPersonId);
    const yesHeadlineCount = state.partyFilter || hasIndividualVotes ? filteredYes.length : counts.for;
    const noHeadlineCount = state.partyFilter || hasIndividualVotes ? filteredNo.length : counts.imod;

    document.querySelector("#vote-yes-title").textContent =
      `${window.Folkevalget.formatNumber(yesHeadlineCount)} stemte for`;
    document.querySelector("#vote-no-title").textContent =
      `${window.Folkevalget.formatNumber(noHeadlineCount)} stemte imod`;

    const filterSummary = document.querySelector("#vote-filter-summary");
    if (!participantDetailsReady && state.voteDetailLoadingById.has(Number(vote?.afstemning_id || 0))) {
      filterSummary.textContent = "Indlæser individuelle stemmer fra ODA…";
    } else if (state.partyFilter) {
      filterSummary.textContent =
        `${formatPartyLabel(state.partyFilter)}: ${window.Folkevalget.formatNumber(filteredYes.length)} for og ${window.Folkevalget.formatNumber(filteredNo.length)} imod. Grafen viser det samme udsnit.`;
    } else if (noDecisionData) {
      filterSummary.textContent = "Ingen registrerede ja- eller nej-stemmer for denne afstemning i ODA. Se konklusionen nedenfor for den parlamentariske kontekst.";
    } else if (!hasIndividualVotes && effectiveCountSource(vote) === "konklusion") {
      filterSummary.textContent = "Viser samlede ja- og nej-tal fra sagens konklusion. Individuelle stemmer er ikke registreret i ODA.";
    } else {
      filterSummary.textContent = "Viser alle registrerede ja- og nej-stemmer for denne afstemning.";
    }

    renderVoteDistribution(visibleCounts);
    const yesEmptyMessage = noDecisionData
      ? "Ingen registrerede medlemmer stemte for i ODA for denne afstemning."
      : "Ingen registrerede medlemmer i denne visning.";
    const noEmptyMessage = noDecisionData
      ? "Ingen registrerede medlemmer stemte imod i ODA for denne afstemning."
      : "Ingen registrerede medlemmer i denne visning.";
    renderParticipantList(document.querySelector("#vote-yes-list"), filteredYes, yesEmptyMessage);
    renderParticipantList(document.querySelector("#vote-no-list"), filteredNo, noEmptyMessage);
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
    if (isCloseVote(vote, state.closeThresholdPct)) {
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
    const ids = state.partyFilter
      ? vote.vote_groups_by_party?.[state.partyFilter]?.[groupKey] || []
      : vote.vote_groups?.[groupKey] || [];
    return dedupeNumericIds(ids);
  }

  function dedupeNumericIds(ids) {
    const seen = new Set();
    const unique = [];
    for (const rawId of ids || []) {
      const id = Number(rawId);
      if (!Number.isFinite(id) || seen.has(id)) {
        continue;
      }
      seen.add(id);
      unique.push(id);
    }
    return unique;
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

  function renderParticipantList(root, participants, emptyMessage = "Ingen registrerede medlemmer i denne visning.") {
    root.innerHTML = "";

    if (participants.length === 0) {
      const safeMessage = String(emptyMessage || "Ingen registrerede medlemmer i denne visning.");
      root.innerHTML = `<div class="panel-empty">${safeMessage}</div>`;
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

  function parseKonklusionCounts(konklusion) {
    const text = String(konklusion || "").replace(/\s+/g, " ").trim();
    if (!text) {
      return null;
    }

    const patterns = {
      for: /\bfor stemte\s+(\d+)/i,
      imod: /\bimod stemte\s+(\d+)/i,
      hverken: /\bhverken for eller imod stemte\s+(\d+)/i,
      fravaer: /\bfrav(?:æ|ae)r(?:ende)?(?:\s+var)?\s+(\d+)/i,
    };

    const parsed = { for: 0, imod: 0, hverken: 0, fravaer: 0 };
    let matchedAny = false;
    for (const [key, pattern] of Object.entries(patterns)) {
      const match = pattern.exec(text);
      if (!match) {
        continue;
      }
      parsed[key] = Number(match[1] || 0);
      matchedAny = true;
    }

    return matchedAny ? parsed : null;
  }

  function effectiveCountSource(vote) {
    if (vote.counts_source === "konklusion") {
      return "konklusion";
    }
    const forCount = Number(vote.counts?.for || 0);
    const imodCount = Number(vote.counts?.imod || 0);
    if (forCount > 0 || imodCount > 0) {
      return "stemme";
    }
    const parsed = parseKonklusionCounts(vote.konklusion);
    if (!parsed) {
      return "stemme";
    }
    return parsed.for > 0 || parsed.imod > 0 || parsed.hverken > 0 || parsed.fravaer > 0
      ? "konklusion"
      : "stemme";
  }

  function effectiveCounts(vote) {
    const base = {
      for: Number(vote.counts?.for || 0),
      imod: Number(vote.counts?.imod || 0),
      fravaer: Number(vote.counts?.fravaer || 0),
      hverken: Number(vote.counts?.hverken || 0),
    };
    if (effectiveCountSource(vote) !== "konklusion") {
      return base;
    }
    const parsed = parseKonklusionCounts(vote.konklusion);
    if (!parsed) {
      return base;
    }
    return {
      for: parsed.for,
      imod: parsed.imod,
      fravaer: parsed.fravaer,
      hverken: parsed.hverken,
    };
  }

  function hasIndividualVoteRows(vote) {
    return ["for", "imod", "fravaer", "hverken"].some((key) =>
      Number(vote.vote_groups?.[key]?.length || 0) > 0
    );
  }

  function voteDecisionTotal(vote) {
    const counts = effectiveCounts(vote);
    return counts.for + counts.imod;
  }

  function voteMarginSharePct(vote) {
    const counts = effectiveCounts(vote);
    const total = voteDecisionTotal(vote);
    if (total === 0) {
      return Number.POSITIVE_INFINITY;
    }
    return (Math.abs(counts.for - counts.imod) / total) * 100;
  }

  function normaliseTitleForMatch(text) {
    return (text || "").toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ").trim();
  }

  function classifyVoteType(vote) {
    const prefix = (vote.sag_number || "").match(/^([A-ZÆØÅ]+)/u)?.[1] || "";
    if (prefix === "B") {
      const title = vote.sag_short_title || vote.sag_title || "";
      if (/\(borgerforslag\)/i.test(title)) return "B_borger";
    }
    if (prefix === "V") {
      const timeline = timelineBySagId(vote.sag_id);
      const relatedCasePrefixes = Array.isArray(timeline?.related_case_prefixes)
        ? timeline.related_case_prefixes
        : [];
      for (const relatedPrefix of relatedCasePrefixes) {
        if (relatedPrefix === "F" || relatedPrefix === "R") {
          return relatedPrefix;
        }
      }

      const relatedCases = Array.isArray(timeline?.related_cases) ? timeline.related_cases : [];
      for (const relatedCase of relatedCases) {
        const relatedPrefix = String(relatedCase?.sag_number || "").match(/^([A-ZÆØÅ]+)/u)?.[1] || "";
        if (relatedPrefix === "F" || relatedPrefix === "R") {
          return relatedPrefix;
        }
      }
    }
    if (prefix === "V" && state.rfDocs.length > 0) {
      const vTitle = normaliseTitleForMatch(vote.sag_short_title || vote.sag_title || "");
      if (vTitle.length >= 10) {
        for (const doc of state.rfDocs) {
          const rfTitle = normaliseTitleForMatch(doc.titel || "");
          if (rfTitle.length >= 10 && (rfTitle.startsWith(vTitle) || vTitle.startsWith(rfTitle))) {
            return doc.type;
          }
        }
      }
    }
    return prefix;
  }

  function sanitiseCloseThresholdPct(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return DEFAULT_CLOSE_VOTE_THRESHOLD_PCT;
    }
    const rounded = Math.round(numeric);
    return Math.min(MAX_CLOSE_VOTE_THRESHOLD_PCT, Math.max(MIN_CLOSE_VOTE_THRESHOLD_PCT, rounded));
  }

  function isCloseVote(vote, maxMarginPct = DEFAULT_CLOSE_VOTE_THRESHOLD_PCT) {
    return voteDecisionTotal(vote) > 0 && voteMarginSharePct(vote) <= sanitiseCloseThresholdPct(maxMarginPct);
  }

  function hasPartySplit(vote) {
    return Number(vote.party_split_count || 0) > 0;
  }

  function splitPartyLabels(vote) {
    return Object.entries(vote.vote_groups_by_party || {})
      .filter(([, groups]) => Number(groups?.for?.length || 0) > 0 && Number(groups?.imod?.length || 0) > 0)
      .map(([partyKey]) => formatPartyLabel(partyKey))
      .sort((left, right) => left.localeCompare(right, "da"));
  }

  function describeSplitParties(splitParties, splitCount) {
    if (splitParties.length > 0) {
      return `Intern uenighed i ${formatTextList(splitParties)}.`;
    }

    if (splitCount > 0) {
      return `${window.Folkevalget.formatNumber(splitCount)} parti${splitCount === 1 ? "" : "er"} havde intern uenighed.`;
    }

    return "Ingen registrerede partisplits i denne afstemning.";
  }

  function formatTextList(items) {
    if (items.length <= 1) {
      return items[0] || "";
    }

    if (items.length === 2) {
      return `${items[0]} og ${items[1]}`;
    }

    return `${items.slice(0, -1).join(", ")} og ${items[items.length - 1]}`;
  }

  function isMistakeVoteComment(comment) {
    return /^Ved en fejl\b/i.test(String(comment || "").trim());
  }

  function mistakeVoteInSplitParty(vote) {
    if (!isMistakeVoteComment(vote.kommentar)) return false;
    const match = String(vote.kommentar).match(/\(([A-ZÆØÅ]{1,4})\)/u);
    if (!match) return false;
    const groups = vote.vote_groups_by_party?.[match[1]];
    return Number(groups?.for?.length || 0) > 0 && Number(groups?.imod?.length || 0) > 0;
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

  function votePrimaryEmneordLabel(vote) {
    const entries = emneordEntriesForVote(vote);
    if (entries.length === 0) {
      return "";
    }
    const labels = entries
      .map((entry) => String(entry?.emneord || "").trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, "da"));
    return labels[0] || "";
  }

  function emneordEntriesForVote(vote) {
    const timeline = timelineBySagId(vote?.sag_id);
    const emneord = timeline?.emneord || {};
    const sagEntries = Array.isArray(emneord.sag) ? emneord.sag : [];
    const dokumentEntries = Array.isArray(emneord.dokumenter) ? emneord.dokumenter : [];
    const fallbackEntries = Array.isArray(emneord.samlet) ? emneord.samlet : [];
    const summaryLabels = Array.isArray(emneord.labels) ? emneord.labels : [];

    const entries = [];
    const seen = new Set();
    const sourceLists =
      sagEntries.length > 0 || dokumentEntries.length > 0
        ? [sagEntries, dokumentEntries]
        : [fallbackEntries];

    for (const source of sourceLists) {
      for (const entry of source) {
        const label = String(entry?.emneord || "").trim();
        if (!label) {
          continue;
        }
        const type = String(entry?.type || "").trim();
        const key = `${label.toLowerCase()}||${type.toLowerCase()}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        entries.push({
          emneord: label,
          type,
        });
      }
    }

    if (entries.length === 0 && summaryLabels.length > 0) {
      for (const label of summaryLabels) {
        const value = String(label || "").trim();
        if (!value) {
          continue;
        }
        const key = value.toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        entries.push({
          emneord: value,
          type: "",
        });
      }
    }

    return entries;
  }

  function formatEmneordEntry(entry) {
    const label = String(entry?.emneord || "").trim();
    const type = String(entry?.type || "").trim();
    if (!label) {
      return "";
    }
    return type ? `${label} (${type})` : label;
  }

  function formatResumeText(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function findFremsatUnderRelatedCase(relatedCases) {
    const list = Array.isArray(relatedCases) ? relatedCases : [];
    for (const relatedCase of list) {
      if (isFremsatUnderRelatedCase(relatedCase)) {
        return relatedCase;
      }
    }
    return null;
  }

  function isFremsatUnderRelatedCase(relatedCase) {
    const relations = Array.isArray(relatedCase?.relations) ? relatedCase.relations : [];
    return relations.some((relation) => compactTimelineText(relation) === "fremsatunder");
  }

  function buildRelatedCaseLabel(relatedCase) {
    const caseLabel = relatedCase?.sag_number || `Sag ${relatedCase?.sag_id || ""}`.trim();
    const title = relatedCase?.sag_short_title || relatedCase?.sag_title || "Relateret sag";
    return `${caseLabel}: ${title}`;
  }

  function buildTimelineStatusParts(step, titleText) {
    const parts = [];
    const compactTitle = compactTimelineText(titleText);
    const compactType = compactTimelineText(step?.type);
    const compactStatus = compactTimelineText(step?.status);
    if (step?.type && compactType && compactType !== compactTitle) {
      parts.push(step.type);
    }
    if (step?.status && compactStatus && compactStatus !== compactTitle && compactStatus !== compactType) {
      parts.push(step.status);
    }
    return parts;
  }

  function isFremsaettelseStep(step) {
    const titleText = compactTimelineText(step?.title);
    const typeText = compactTimelineText(step?.type);
    return titleText.includes("fremsaettelse") || typeText.includes("fremsaettelse");
  }

  function compactTimelineText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replaceAll("æ", "ae")
      .replaceAll("ø", "oe")
      .replaceAll("å", "aa")
      .replace(/[^a-z0-9]+/g, "");
  }

  function findLatestTimelineIndex(items) {
    let latestDate = "";
    let latestIndex = -1;
    for (let index = 0; index < items.length; index += 1) {
      const dateValue = isIsoDate(items[index]?.date) ? String(items[index].date) : "";
      if (!dateValue) {
        continue;
      }
      if (dateValue > latestDate || (dateValue === latestDate && index > latestIndex)) {
        latestDate = dateValue;
        latestIndex = index;
      }
    }
    if (latestIndex >= 0) {
      return latestIndex;
    }
    return items.length > 0 ? items.length - 1 : -1;
  }

  function formatOmtrykLabel(omtrykEntries) {
    const entries = Array.isArray(omtrykEntries) ? omtrykEntries : [];
    if (entries.length === 0) {
      return "";
    }
    const dated = entries
      .map((entry) => (isIsoDate(entry?.date) ? String(entry.date) : ""))
      .filter(Boolean)
      .sort();
    if (dated.length === 0) {
      return "Omtryk";
    }
    return `Omtryk ${window.Folkevalget.formatDate(dated[dated.length - 1])}`;
  }

  function formatOmtrykReason(omtrykEntries) {
    const entries = Array.isArray(omtrykEntries) ? omtrykEntries : [];
    for (const entry of entries) {
      const reason = String(entry?.reason || "").trim();
      if (reason) {
        return reason;
      }
    }
    return "";
  }

  function compactVoteSearchText(value) {
    return String(value || "").replace(/[\s-]+/g, "");
  }

  function isIsoDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
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
