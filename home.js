const HomeApp = (() => {
  const statsRoot = document.querySelector("[data-site-stats]");
  const heroProfileCount = document.querySelector("[data-home='profiles']");
  const heroVoteCount = document.querySelector("[data-home='votes']");
  const heroUpdated = document.querySelector("[data-home='updated']");
  const newVotesFeedRoot = document.querySelector("#feed-new-votes");
  const omtrykFeedRoot = document.querySelector("#feed-omtryk");
  const state = { votes: [] };

  async function boot() {
    const [{ stats }, votes] = await Promise.all([
      window.Folkevalget.loadCatalogueData(),
      window.Folkevalget.loadVoteOverview().catch(() => []),
    ]);

    state.votes = Array.isArray(votes) ? votes.slice().sort(compareVotesNewestFirst) : [];
    window.Folkevalget.renderStats(statsRoot, stats);
    renderHeroNumbers(stats);
    renderDailyFeed();
  }

  function renderHeroNumbers(stats) {
    heroProfileCount.textContent = window.Folkevalget.formatNumber(stats.counts?.profiles);
    heroVoteCount.textContent = window.Folkevalget.formatNumber(stats.counts?.votes);
    heroUpdated.textContent = window.Folkevalget.formatDate(stats.generated_at);
  }

  function renderDailyFeed() {
    renderNewVotesFeed();
    renderOmtrykFeed();
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

  function isoDateDaysAgo(days) {
    const anchor = new Date();
    anchor.setHours(0, 0, 0, 0);
    anchor.setDate(anchor.getDate() - Math.max(0, Number(days || 0)));
    return anchor.toLocaleDateString("sv-SE", { timeZone: "Europe/Copenhagen" });
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

HomeApp.boot().catch((error) => {
  console.error(error);
});
