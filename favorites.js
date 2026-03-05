const FavoritesApp = (() => {
  const state = {
    profilesById: new Map(),
    timelineBySagId: new Map(),
    votesByCaseNumber: new Map(),
    latestVoteBySagId: new Map(),
    votes: [],
    favorites: { profiles: [], cases: [] },
  };

  const statsRoot = document.querySelector("[data-site-stats]");
  const summaryRoot = document.querySelector("#favorites-summary");
  const favoriteCasesRoot = document.querySelector("#favorite-cases");
  const favoriteProfilesRoot = document.querySelector("#favorite-profiles");
  const newVotesFeedRoot = document.querySelector("#feed-new-votes");
  const omtrykFeedRoot = document.querySelector("#feed-omtryk");
  const partySplitsFeedRoot = document.querySelector("#feed-party-splits");
  const activeStatusFeedRoot = document.querySelector("#feed-active-status");

  async function boot() {
    const [{ profiles, stats }, votes, timelineIndex] = await Promise.all([
      window.Folkevalget.loadCatalogueData(),
      window.Folkevalget.loadVoteOverview().catch(() => []),
      window.Folkevalget.fetchJson("data/sag_tidslinjer_index.json").catch(() => []),
    ]);

    window.Folkevalget.renderStats(statsRoot, stats);
    state.profilesById = new Map((profiles || []).map((profile) => [Number(profile.id), profile]));
    state.votes = Array.isArray(votes) ? votes.slice().sort(compareVotesNewestFirst) : [];
    state.timelineBySagId = new Map();
    for (const row of Array.isArray(timelineIndex) ? timelineIndex : []) {
      const sagId = Number(row?.sag_id || 0);
      if (sagId > 0) {
        state.timelineBySagId.set(sagId, row);
      }
    }

    hydrateVoteMaps();
    bindEvents();
    render();
  }

  function hydrateVoteMaps() {
    state.votesByCaseNumber = new Map();
    state.latestVoteBySagId = new Map();

    for (const vote of state.votes) {
      const caseNumber = normaliseCaseNumber(vote?.sag_number);
      if (caseNumber) {
        if (!state.votesByCaseNumber.has(caseNumber)) {
          state.votesByCaseNumber.set(caseNumber, []);
        }
        state.votesByCaseNumber.get(caseNumber).push(vote);
      }

      const sagId = Number(vote?.sag_id || 0);
      if (sagId > 0 && !state.latestVoteBySagId.has(sagId)) {
        state.latestVoteBySagId.set(sagId, vote);
      }
    }
  }

  function bindEvents() {
    favoriteCasesRoot?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-case]");
      if (!button) {
        return;
      }

      const caseNumber = String(button.getAttribute("data-remove-case") || "");
      if (!caseNumber) {
        return;
      }

      window.Folkevalget.setFavoriteCase({ sag_number: caseNumber }, false);
      render();
    });

    favoriteProfilesRoot?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-profile]");
      if (!button) {
        return;
      }

      const profileId = Number(button.getAttribute("data-remove-profile") || 0);
      if (!profileId) {
        return;
      }

      window.Folkevalget.setFavoriteProfile({ id: profileId }, false);
      render();
    });

    window.addEventListener(window.Folkevalget.FAVORITES_EVENT_NAME, () => {
      render();
    });
  }

  function render() {
    state.favorites = window.Folkevalget.getFavorites();
    renderSummary();
    renderFavoriteCases();
    renderFavoriteProfiles();
    renderDailyFeed();
  }

  function renderSummary() {
    if (!summaryRoot) {
      return;
    }

    const profileCount = state.favorites.profiles.length;
    const caseCount = state.favorites.cases.length;

    if (profileCount === 0 && caseCount === 0) {
      summaryRoot.textContent =
        "Ingen favoritter endnu. Stjernemarkér en sag i Afstemninger eller en politiker på profilsiden.";
      return;
    }

    summaryRoot.textContent =
      `Du følger ${window.Folkevalget.formatNumber(caseCount)} sager og ` +
      `${window.Folkevalget.formatNumber(profileCount)} politikere.`;
  }

  function renderFavoriteCases() {
    if (!favoriteCasesRoot) {
      return;
    }
    favoriteCasesRoot.innerHTML = "";

    if (state.favorites.cases.length === 0) {
      favoriteCasesRoot.innerHTML = '<div class="panel-empty">Ingen favoritsager endnu.</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const favorite of state.favorites.cases) {
      fragment.append(buildFavoriteCaseItem(favorite));
    }
    favoriteCasesRoot.append(fragment);
  }

  function buildFavoriteCaseItem(favorite) {
    const item = document.createElement("article");
    item.className = "favorite-item";

    const caseNumber = normaliseCaseNumber(favorite?.sag_number);
    const votes = state.votesByCaseNumber.get(caseNumber) || [];
    const latestVote = votes[0] || null;
    const timeline = timelineForCase(favorite, latestVote);
    const titleText =
      String(favorite?.title || "").trim() ||
      String(latestVote?.sag_short_title || latestVote?.sag_title || "").trim() ||
      caseNumber;

    const head = document.createElement("div");
    head.className = "favorite-item-head";

    const titleLink = document.createElement("a");
    titleLink.className = "favorite-item-title";
    titleLink.href = `${window.Folkevalget.toSiteUrl("afstemninger.html")}?q=${encodeURIComponent(caseNumber)}`;
    titleLink.textContent = `${caseNumber} · ${titleText}`;
    head.append(titleLink);

    const remove = document.createElement("button");
    remove.className = "favorite-remove-button";
    remove.type = "button";
    remove.textContent = "Fjern";
    remove.setAttribute("data-remove-case", caseNumber);
    head.append(remove);

    const meta = document.createElement("p");
    meta.className = "favorite-item-meta";
    const status = String(timeline?.sag_status || latestVote?.sagstrin_status || "Status ikke registreret");
    const latestDate = latestVote?.date ? window.Folkevalget.formatDate(latestVote.date) : "Ingen afstemningsdato";
    meta.textContent = `${status} · Seneste afstemning: ${latestDate}`;

    item.append(head, meta);

    const updateNotes = buildCaseUpdateNotes(favorite, timeline, votes);
    for (const text of updateNotes) {
      item.append(buildUpdateLine(text));
    }

    const links = document.createElement("p");
    links.className = "favorite-item-links";

    if (latestVote?.afstemning_id) {
      const voteLink = document.createElement("a");
      voteLink.href = window.Folkevalget.buildVoteUrl(latestVote.afstemning_id);
      voteLink.textContent = "Se seneste afstemning";
      links.append(voteLink);
    }

    const officialUrl = window.Folkevalget.buildSagUrl(caseNumber, latestVote?.date || null);
    if (officialUrl) {
      if (links.childElementCount > 0) {
        links.append(document.createTextNode(" · "));
      }
      const officialLink = document.createElement("a");
      officialLink.href = officialUrl;
      officialLink.target = "_blank";
      officialLink.rel = "noreferrer";
      officialLink.textContent = "Åbn sag på ft.dk";
      links.append(officialLink);
    }

    if (links.childElementCount > 0) {
      item.append(links);
    }

    return item;
  }

  function renderFavoriteProfiles() {
    if (!favoriteProfilesRoot) {
      return;
    }
    favoriteProfilesRoot.innerHTML = "";

    if (state.favorites.profiles.length === 0) {
      favoriteProfilesRoot.innerHTML = '<div class="panel-empty">Ingen favoritpolitikere endnu.</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const favorite of state.favorites.profiles) {
      fragment.append(buildFavoriteProfileItem(favorite));
    }
    favoriteProfilesRoot.append(fragment);
  }

  function buildFavoriteProfileItem(favorite) {
    const item = document.createElement("article");
    item.className = "favorite-item";

    const profileId = Number(favorite?.id || 0);
    const profile = state.profilesById.get(profileId) || null;
    const latestVote = latestProfileVote(profile);
    const name = String(profile?.name || favorite?.name || `Profil ${profileId}`);
    const partyName = window.Folkevalget.partyDisplayName(
      profile?.party || favorite?.party || null,
      profile?.party_short || favorite?.party_short || null
    );

    const head = document.createElement("div");
    head.className = "favorite-item-head";

    const titleLink = document.createElement("a");
    titleLink.className = "favorite-item-title";
    titleLink.href = window.Folkevalget.buildProfileUrl(profileId);
    titleLink.textContent = name;
    head.append(titleLink);

    const remove = document.createElement("button");
    remove.className = "favorite-remove-button";
    remove.type = "button";
    remove.textContent = "Fjern";
    remove.setAttribute("data-remove-profile", String(profileId));
    head.append(remove);

    const meta = document.createElement("p");
    meta.className = "favorite-item-meta";
    const latestDate = latestVote?.date ? window.Folkevalget.formatDate(latestVote.date) : "Ingen afstemningsdato";
    meta.textContent = `${partyName || "Parti ikke registreret"} · Seneste stemme: ${latestDate}`;

    item.append(head, meta);

    const updateLabel = buildUpdateLineIfNewer(
      favorite?.saved_at,
      latestVote?.date,
      "Ny stemme registreret siden du fulgte profilen."
    );
    if (updateLabel) {
      item.append(updateLabel);
    }

    if (latestVote?.sag_number) {
      const links = document.createElement("p");
      links.className = "favorite-item-links";
      const caseLink = document.createElement("a");
      caseLink.href = `${window.Folkevalget.toSiteUrl("afstemninger.html")}?q=${encodeURIComponent(latestVote.sag_number)}`;
      caseLink.textContent = `Seneste sag: ${latestVote.sag_number}`;
      links.append(caseLink);
      item.append(links);
    }

    return item;
  }

  function renderDailyFeed() {
    renderNewVotesFeed();
    renderOmtrykFeed();
    renderPartySplitsFeed();
    renderActiveStatusFeed();
  }

  function renderNewVotesFeed() {
    if (!newVotesFeedRoot) {
      return;
    }

    const cutoff = isoDateDaysAgo(7);
    let rows = state.votes.filter((vote) => String(vote?.date || "") >= cutoff).slice(0, 8);
    if (rows.length === 0) {
      rows = state.votes.slice(0, 8);
    }

    renderFeedList(
      newVotesFeedRoot,
      rows.map((vote) => ({
        title: `${vote.sag_number || "Sag"} · ${vote.sag_short_title || vote.sag_title || "Afstemning"}`,
        meta: `${window.Folkevalget.formatDate(vote.date)} · ${vote.vedtaget ? "Vedtaget" : "Forkastet"}`,
        href: window.Folkevalget.buildVoteUrl(vote.afstemning_id),
      })),
      "Ingen nye afstemninger i den valgte periode."
    );
  }

  function renderOmtrykFeed() {
    if (!omtrykFeedRoot) {
      return;
    }

    const rows = [];
    const seenDocumentIds = new Set();
    for (const vote of state.votes) {
      const documents = Array.isArray(vote?.source_documents) ? vote.source_documents : [];
      for (const document of documents) {
        const documentId = Number(document?.document_id || 0);
        if (documentId > 0 && seenDocumentIds.has(documentId)) {
          continue;
        }

        const title = String(document?.title || "").trim();
        const variantCode = String(document?.variant_code || "").toUpperCase();
        if (!/omtryk/i.test(title) && !/omtryk/i.test(variantCode)) {
          continue;
        }

        if (documentId > 0) {
          seenDocumentIds.add(documentId);
        }

        rows.push({
          title: `${vote.sag_number || "Sag"} · ${title || "Dokument"}`,
          meta: `${window.Folkevalget.formatDate(document?.date || vote?.date)} · ${document?.format || "Dokument"}`,
          href: String(document?.url || "").trim() || window.Folkevalget.buildVoteUrl(vote.afstemning_id),
        });
      }
      if (rows.length >= 8) {
        break;
      }
    }

    renderFeedList(omtrykFeedRoot, rows.slice(0, 8), "Ingen omtryk fundet i de registrerede dokumenter.");
  }

  function renderPartySplitsFeed() {
    if (!partySplitsFeedRoot) {
      return;
    }

    const rows = state.votes
      .filter((vote) => Number(vote?.party_split_count || 0) > 0)
      .slice(0, 8)
      .map((vote) => ({
        title: `${vote.sag_number || "Sag"} · ${vote.sag_short_title || vote.sag_title || "Afstemning"}`,
        meta:
          `${window.Folkevalget.formatDate(vote.date)} · ` +
          `${window.Folkevalget.formatNumber(vote.party_split_count)} partisplit`,
        href: window.Folkevalget.buildVoteUrl(vote.afstemning_id),
      }));

    renderFeedList(partySplitsFeedRoot, rows, "Ingen partisplit i de seneste registrerede afstemninger.");
  }

  function renderActiveStatusFeed() {
    if (!activeStatusFeedRoot) {
      return;
    }

    const rows = [];
    for (const timeline of state.timelineBySagId.values()) {
      if (!isActiveStatus(timeline?.sag_status)) {
        continue;
      }

      const sagId = Number(timeline?.sag_id || 0);
      const latestVote = state.latestVoteBySagId.get(sagId) || null;
      const caseNumber = inferCaseNumberFromTimelineAndVote(timeline, latestVote);
      if (!caseNumber) {
        continue;
      }

      rows.push({
        title: `${caseNumber} · ${timeline?.sag_type || "Sag"}`,
        meta: `${timeline?.sag_status || "Status ikke registreret"}`,
        sortDate: String(latestVote?.date || ""),
        href: `${window.Folkevalget.toSiteUrl("afstemninger.html")}?q=${encodeURIComponent(caseNumber)}`,
      });
    }

    rows.sort((left, right) => String(right.sortDate || "").localeCompare(String(left.sortDate || "")));
    renderFeedList(
      activeStatusFeedRoot,
      rows.slice(0, 8).map(({ title, meta, href }) => ({ title, meta, href })),
      "Ingen aktive sager fundet i den aktuelle statusoversigt."
    );
  }

  function renderFeedList(root, rows, emptyText) {
    root.innerHTML = "";
    if (!Array.isArray(rows) || rows.length === 0) {
      root.innerHTML = `<div class="panel-empty">${emptyText}</div>`;
      return;
    }

    const list = document.createElement("ul");
    list.className = "favorite-list";

    for (const row of rows) {
      const item = document.createElement("li");
      item.className = "favorite-item";

      const link = document.createElement("a");
      link.className = "favorite-item-title";
      link.href = row.href || "#";
      if (String(row.href || "").startsWith("http")) {
        link.target = "_blank";
        link.rel = "noreferrer";
      }
      link.textContent = row.title || "Uden titel";

      const meta = document.createElement("p");
      meta.className = "favorite-item-meta";
      meta.textContent = row.meta || "";

      item.append(link, meta);
      list.append(item);
    }

    root.append(list);
  }

  function timelineForCase(favoriteCase, latestVote) {
    const favoriteSagId = Number(favoriteCase?.sag_id || 0);
    if (favoriteSagId > 0 && state.timelineBySagId.has(favoriteSagId)) {
      return state.timelineBySagId.get(favoriteSagId);
    }

    const voteSagId = Number(latestVote?.sag_id || 0);
    if (voteSagId > 0 && state.timelineBySagId.has(voteSagId)) {
      return state.timelineBySagId.get(voteSagId);
    }

    return null;
  }

  function latestProfileVote(profile) {
    const votes = Array.isArray(profile?.recent_votes) ? profile.recent_votes : [];
    if (votes.length === 0) {
      return null;
    }
    return votes.slice().sort((left, right) => String(right?.date || "").localeCompare(String(left?.date || "")))[0];
  }

  function buildCaseUpdateNotes(favorite, timeline, votes) {
    const notes = [];
    const latestVote = votes[0] || null;
    const baselineVoteDate = toIsoDate(favorite?.saved_latest_vote_date || favorite?.saved_at);
    const latestVoteDate = toIsoDate(latestVote?.date);

    if (baselineVoteDate && latestVoteDate && latestVoteDate > baselineVoteDate) {
      notes.push(`Ny afstemning siden du fulgte sagen (${window.Folkevalget.formatDate(latestVoteDate)}).`);
    }

    const omtrykChanges = omtrykChangesAfterDate(votes, baselineVoteDate);
    if (omtrykChanges.count > 0) {
      const latestOmtrykPart = omtrykChanges.latestDate
        ? ` Seneste omtryk: ${window.Folkevalget.formatDate(omtrykChanges.latestDate)}.`
        : "";
      notes.push(
        `${window.Folkevalget.formatNumber(omtrykChanges.count)} nyt omtryk siden du fulgte sagen.${latestOmtrykPart}`
      );
    }

    const savedStatus = String(favorite?.saved_status || "").trim();
    const currentStatus = String(timeline?.sag_status || latestVote?.sagstrin_status || "").trim();
    if (savedStatus && currentStatus && compactStatus(savedStatus) !== compactStatus(currentStatus)) {
      notes.push(`Sagsstatus ændret fra "${savedStatus}" til "${currentStatus}".`);
    }

    return notes;
  }

  function omtrykChangesAfterDate(votes, afterDate) {
    const baseline = toIsoDate(afterDate);
    if (!baseline) {
      return { count: 0, latestDate: null };
    }

    const seen = new Set();
    let count = 0;
    let latestDate = "";

    for (const vote of Array.isArray(votes) ? votes : []) {
      const documents = Array.isArray(vote?.source_documents) ? vote.source_documents : [];
      for (const document of documents) {
        const title = String(document?.title || "").trim();
        const variantCode = String(document?.variant_code || "").trim();
        if (!/omtryk/i.test(title) && !/omtryk/i.test(variantCode)) {
          continue;
        }

        const documentId = Number(document?.document_id || 0);
        const documentDate = toIsoDate(document?.date || vote?.date);
        if (!documentDate || documentDate <= baseline) {
          continue;
        }

        const key =
          documentId > 0
            ? `id:${documentId}`
            : `${title.toLowerCase()}|${variantCode.toLowerCase()}|${documentDate}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        count += 1;
        if (documentDate > latestDate) {
          latestDate = documentDate;
        }
      }
    }

    return { count, latestDate: latestDate || null };
  }

  function compactStatus(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replaceAll("æ", "ae")
      .replaceAll("ø", "oe")
      .replaceAll("å", "aa")
      .replace(/\s+/g, " ");
  }

  function buildUpdateLine(text) {
    const note = document.createElement("p");
    note.className = "favorite-item-update";
    note.textContent = text;
    return note;
  }

  function buildUpdateLineIfNewer(savedAtIso, latestDate, text) {
    const savedDate = toIsoDate(savedAtIso);
    const compareDate = toIsoDate(latestDate);
    if (!savedDate || !compareDate || compareDate <= savedDate) {
      return null;
    }

    return buildUpdateLine(text);
  }

  function inferCaseNumberFromTimelineAndVote(timeline, vote) {
    const voteNumber = normaliseCaseNumber(vote?.sag_number);
    if (voteNumber) {
      return voteNumber;
    }
    const under = normaliseCaseNumber(timeline?.fremsat_under?.sag_number);
    return under || "";
  }

  function isActiveStatus(statusText) {
    const normalized = String(statusText || "").toLowerCase();
    if (!normalized) {
      return false;
    }
    const finalKeywords = ["stadfæstet", "vedtaget", "forkastet", "bortfaldet"];
    return finalKeywords.every((keyword) => !normalized.includes(keyword));
  }

  function isoDateDaysAgo(days) {
    const anchor = new Date();
    anchor.setHours(0, 0, 0, 0);
    anchor.setDate(anchor.getDate() - Math.max(0, Number(days || 0)));
    return anchor.toLocaleDateString("sv-SE", { timeZone: "Europe/Copenhagen" });
  }

  function normaliseCaseNumber(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function toIsoDate(value) {
    if (!value) {
      return null;
    }
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Copenhagen" });
  }

  function compareVotesNewestFirst(left, right) {
    const dateDiff = String(right?.date || "").localeCompare(String(left?.date || ""));
    if (dateDiff !== 0) {
      return dateDiff;
    }
    return Number(right?.afstemning_id || 0) - Number(left?.afstemning_id || 0);
  }

  return { boot };
})();

FavoritesApp.boot().catch((error) => {
  console.error(error);
  const summaryRoot = document.querySelector("#favorites-summary");
  if (summaryRoot) {
    summaryRoot.textContent = "Favoritter kunne ikke indlæses lige nu.";
  }
});
