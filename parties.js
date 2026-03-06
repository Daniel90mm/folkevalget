const PartiesApp = (() => {
  const insightsApi = window.FolkevalgetInsights;
  const VALID_SORTS = new Set([
    "name",
    "members_desc",
    "attendance_desc",
    "loyalty_desc",
    "committee_desc",
    "coverage_desc",
  ]);
  const HIGHLIGHT_MIN_MEMBERS = 5;
  const PARTY_NAME_OVERRIDES = {
    BP: "Borgernes Parti",
    DD: "Danmarksdemokraterne",
    UFG: "Uden for grupperne",
    V: "Venstre",
  };

  const state = {
    rows: [],
    sortMode: "name",
    constituencyCount: 0,
    insights: null,
  };

  const collator = new Intl.Collator("da-DK");
  const statsRoot = document.querySelector("[data-site-stats]");
  const sortSelect = document.querySelector("#party-sort");
  const overviewNote = document.querySelector("#party-overview-note");
  const highlightGrid = document.querySelector("#party-highlight-grid");
  const activitySummary = document.querySelector("#party-activity-summary");
  const activityHighlights = document.querySelector("#party-activity-highlights");
  const splitFeed = document.querySelector("#party-split-feed");
  const topicFeed = document.querySelector("#party-topic-feed");
  const compositionSummary = document.querySelector("#party-composition-summary");
  const seatDistribution = document.querySelector("#party-seat-distribution");
  const seatLegend = document.querySelector("#party-seat-legend");
  const directory = document.querySelector("#party-directory");

  async function boot() {
    hydrateStateFromQuery();

    const insights = await insightsApi.load();
    state.insights = insights;
    state.rows = insights.partyRows.slice();
    state.constituencyCount = countDistinctConstituencies(insights.currentProfiles);

    window.Folkevalget.renderStats(statsRoot, insights.stats);
    syncControls();
    bindEvents();
    renderOverview();
    renderHighlights();
    renderActivity();
    renderComposition();
    renderDirectory();
  }

  function hydrateStateFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const sortMode = params.get("sort") || "name";
    state.sortMode = VALID_SORTS.has(sortMode) ? sortMode : "name";
  }

  function syncControls() {
    if (sortSelect) {
      sortSelect.value = state.sortMode;
    }
  }

  function bindEvents() {
    if (!sortSelect) {
      return;
    }

    sortSelect.addEventListener("change", (event) => {
      state.sortMode = event.target.value;
      renderDirectory();
      syncQueryString();
    });
  }

  function syncQueryString() {
    const params = new URLSearchParams();
    if (state.sortMode !== "name") {
      params.set("sort", state.sortMode);
    }
    const next = params.toString() ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState({}, "", next);
  }

  function buildPartyRows(profiles) {
    const currentProfiles = Array.isArray(profiles)
      ? profiles.filter((profile) => Boolean(profile?.current_party) && Boolean(profile?.storkreds))
      : [];
    const grouped = new Map();

    for (const profile of currentProfiles) {
      const shortName = String(profile?.current_party_short || profile?.party_short || "").trim();
      const key = shortName || String(profile?.current_party || profile?.party || "").trim();
      if (!key) {
        continue;
      }

      if (!grouped.has(key)) {
        grouped.set(key, {
          shortName,
          rawName: String(profile?.current_party || profile?.party || "").trim(),
          members: [],
        });
      }

      grouped.get(key).members.push(profile);
    }

    return [...grouped.values()]
      .map((group) => summariseParty(group.shortName, group.rawName, group.members))
      .filter(Boolean)
      .sort((left, right) => collator.compare(left.partyName, right.partyName));
  }

  function summariseParty(shortName, rawName, members) {
    if (!Array.isArray(members) || members.length === 0) {
      return null;
    }

    const attendanceValues = members
      .map((member) => toNumberOrNull(member.attendance_pct))
      .filter((value) => value !== null);
    const loyaltyValues = members
      .map((member) => toNumberOrNull(member.party_loyalty_pct))
      .filter((value) => value !== null);
    const committeeCounts = members.map((member) => (Array.isArray(member.committees) ? member.committees.length : 0));
    const seniorityValues = members
      .map((member) => toNumberOrNull(member.seniority_years))
      .filter((value) => value !== null);
    const storkredse = [...new Set(members.map((member) => member.storkreds).filter(Boolean))];

    const partyName =
      PARTY_NAME_OVERRIDES[shortName] ||
      window.Folkevalget.PARTY_NAMES[shortName] ||
      rawName ||
      shortName ||
      "Ukendt parti";

    return {
      shortName,
      partyName,
      memberCount: members.length,
      attendanceAvg: averageMetric(attendanceValues),
      loyaltyAvg: averageMetric(loyaltyValues),
      committeeAvg: averageMetric(committeeCounts),
      seniorityAvg: averageMetric(seniorityValues),
      constituencyCount: storkredse.length,
      ministerCount: members.filter((member) => window.Folkevalget.isCurrentMinister(member)).length,
      northAtlanticCount: members.filter((member) => window.Folkevalget.isNorthAtlanticMandate(member)).length,
      discoverUrl: buildDiscoverUrl(shortName || partyName),
      color: partyColor(shortName),
    };
  }

  function averageMetric(values) {
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }
    const sum = values.reduce((total, value) => total + value, 0);
    return Number((sum / values.length).toFixed(1));
  }

  function buildDiscoverUrl(partyKey) {
    return `${window.Folkevalget.toSiteUrl("discover.html")}?party=${encodeURIComponent(partyKey)}`;
  }

  function partyColor(shortName) {
    const badge = document.createElement("span");
    badge.className = "party-code-badge";
    if (shortName) {
      badge.dataset.party = shortName;
    }
    document.body.appendChild(badge);
    const color = window.getComputedStyle(badge).color || "var(--color-accent)";
    document.body.removeChild(badge);
    return color;
  }

  function renderOverview() {
    if (!overviewNote) {
      return;
    }

    const totalMembers = state.rows.reduce((total, row) => total + row.memberCount, 0);
    overviewNote.textContent =
      `${window.Folkevalget.formatNumber(state.rows.length)} grupper og ${window.Folkevalget.formatNumber(totalMembers)} aktuelle medlemmer fordelt på ${window.Folkevalget.formatNumber(state.constituencyCount)} geografiske kredse i datasættet.`;
  }

  function renderHighlights() {
    if (!highlightGrid) {
      return;
    }

    highlightGrid.innerHTML = "";
    if (state.rows.length === 0) {
      highlightGrid.append(buildEmptyState("Ingen partidata i oversigten."));
      return;
    }

    const qualifiedRows = state.rows.filter((row) => row.memberCount >= HIGHLIGHT_MIN_MEMBERS);
    const attendanceLeader = highestRow(qualifiedRows, "attendanceAvg");
    const committeeLeader = highestRow(qualifiedRows, "committeeAvg");
    const biggestGroup = highestRow(state.rows, "memberCount");
    const ministerLeader = highestRow(state.rows, "ministerCount");

    const highlights = [
      {
        label: "Største gruppe",
        value: biggestGroup ? `${window.Folkevalget.formatNumber(biggestGroup.memberCount)} mandater` : "–",
        text: biggestGroup ? biggestGroup.partyName : "Ingen data",
      },
      {
        label: "Højeste fremmøde*",
        value: attendanceLeader ? window.Folkevalget.formatPercent(attendanceLeader.attendanceAvg) : "–",
        text: attendanceLeader ? attendanceLeader.partyName : "Ingen data",
      },
      {
        label: "Højeste udvalgsspredning*",
        value: committeeLeader ? formatDecimal(committeeLeader.committeeAvg) : "–",
        text: committeeLeader ? `${committeeLeader.partyName} · udvalg pr. medlem` : "Ingen data",
      },
      {
        label: "Flest ministre",
        value: ministerLeader ? `${window.Folkevalget.formatNumber(ministerLeader.ministerCount)} ministre` : "–",
        text: ministerLeader ? ministerLeader.partyName : "Ingen data",
      },
    ];

    for (const highlight of highlights) {
      const article = document.createElement("article");
      article.className = "party-highlight";

      const label = document.createElement("span");
      label.className = "signal-label";
      label.textContent = highlight.label;

      const value = document.createElement("strong");
      value.textContent = highlight.value;

      const text = document.createElement("p");
      text.textContent = highlight.text;

      article.append(label, value, text);
      highlightGrid.append(article);
    }
  }

  function renderActivity() {
    if (!activitySummary || !activityHighlights || !state.insights) {
      return;
    }

    const recent30 = state.insights.recentActivity.windows[30];
    const topCommittee = state.insights.committees.topRecent[0] || null;
    const topTopic = state.insights.topics.leadingTopic || null;

    activitySummary.textContent =
      `Seneste registrerede aktivitet går til ${window.Folkevalget.formatDate(state.insights.anchorDate)}. Her er de signaler, der mest påvirker partiernes arbejde lige nu.`;

    activityHighlights.innerHTML = "";
    const highlights = [
      {
        label: "Afstemninger, 30 dage",
        value: `${window.Folkevalget.formatNumber(recent30.votes)} afstemninger`,
        text: `${window.Folkevalget.formatNumber(recent30.casesTouched)} sager berørt i salen eller via møder.`,
      },
      {
        label: "Partisplits, 30 dage",
        value: `${window.Folkevalget.formatNumber(recent30.splitVotes)} partisplits`,
        text: "Afstemninger hvor mindst ét parti stemte forskelligt internt.",
      },
      {
        label: "Tætte afstemninger",
        value: `${window.Folkevalget.formatNumber(recent30.closeVotes)} tætte`,
        text: "Ja/nej-margin på højst 10 % i den aktuelle periode.",
      },
      {
        label: "Mest aktive udvalg",
        value: topCommittee ? topCommittee.shortName : "–",
        text: topCommittee
          ? `${topCommittee.name} · ${window.Folkevalget.formatNumber(topCommittee.recentMeetingCount180)} møder på 180 dage`
          : "Ingen udvalgsmøder i den aktuelle periode.",
      },
    ];

    for (const highlight of highlights) {
      const article = document.createElement("article");
      article.className = "party-highlight";

      const label = document.createElement("span");
      label.className = "signal-label";
      label.textContent = highlight.label;

      const value = document.createElement("strong");
      value.textContent = highlight.value;

      const text = document.createElement("p");
      text.textContent = highlight.text;

      article.append(label, value, text);
      activityHighlights.append(article);
    }

    renderInsightList(
      splitFeed,
      state.insights.recentActivity.splitVotes,
      (vote) => ({
        title: `${vote.caseNumber || `Afstemning ${vote.number}`} · ${vote.caseTitle}`,
        href: vote.voteUrl,
        meta: [
          window.Folkevalget.formatDate(vote.date),
          `${window.Folkevalget.formatNumber(vote.partySplitCount)} partisplits`,
          vote.passed ? "Vedtaget" : "Forkastet",
        ],
        note: vote.topicDisplay || null,
      }),
      "Ingen partisplits i den aktuelle periode."
    );

    renderInsightList(
      topicFeed,
      state.insights.topics.recentTopics,
      (topic) => ({
        title: topic.displayLabel,
        href: topic.href,
        meta: [
          `${window.Folkevalget.formatNumber(topic.voteCount)} afstemninger`,
          `${window.Folkevalget.formatNumber(topic.caseCount)} sager`,
        ],
        note: topTopic && topTopic.label === topic.label
          ? "Hyppigste sagsområde i den aktuelle periode."
          : (topic.latestDate ? `Senest ${window.Folkevalget.formatDate(topic.latestDate)}` : null),
      }),
      "Ingen gentagne emneord i den aktuelle periode."
    );
  }

  function renderComposition() {
    if (!seatDistribution || !seatLegend || !compositionSummary) {
      return;
    }

    seatDistribution.innerHTML = "";
    seatLegend.innerHTML = "";

    if (state.rows.length === 0) {
      compositionSummary.textContent = "Ingen mandatfordeling i datasættet.";
      seatDistribution.append(buildEmptyState("Ingen mandatfordeling at vise."));
      return;
    }

    const sortedBySeats = [...state.rows].sort((left, right) => {
      return right.memberCount - left.memberCount || collator.compare(left.partyName, right.partyName);
    });
    const totalMembers = sortedBySeats.reduce((total, row) => total + row.memberCount, 0);

    compositionSummary.textContent =
      `${window.Folkevalget.formatNumber(totalMembers)} mandater fordelt på ${window.Folkevalget.formatNumber(sortedBySeats.length)} partier og grupper. Fordelingen er sorteret størst først.`;

    for (const row of sortedBySeats) {
      const segment = document.createElement("a");
      segment.className = "party-seat-segment";
      segment.href = row.discoverUrl;
      segment.style.setProperty("--party-color", row.color);
      segment.style.flex = `${row.memberCount} 0 0`;
      segment.title = `${row.partyName}: ${window.Folkevalget.formatNumber(row.memberCount)} ${pluralize(row.memberCount, "mandat", "mandater")}`;
      seatDistribution.append(segment);

      const legendRow = document.createElement("div");
      legendRow.className = "party-seat-row";
      legendRow.style.setProperty("--party-color", row.color);

      const partyLink = document.createElement("a");
      partyLink.className = "party-seat-party";
      partyLink.href = row.discoverUrl;

      const badge = buildPartyBadge(row.shortName, row.shortName || row.partyName);
      const name = document.createElement("span");
      name.className = "party-seat-party-name";
      name.textContent = row.partyName;
      partyLink.append(badge, name);

      const meter = document.createElement("div");
      meter.className = "party-seat-meter";
      const fill = document.createElement("span");
      fill.className = "party-seat-meter-fill";
      fill.style.width = `${(row.memberCount / totalMembers) * 100}%`;
      meter.append(fill);

      const count = document.createElement("strong");
      count.className = "party-seat-count";
      count.textContent = window.Folkevalget.formatNumber(row.memberCount);

      const share = document.createElement("span");
      share.className = "party-seat-share";
      share.textContent = window.Folkevalget.formatPercent(((row.memberCount / totalMembers) * 100).toFixed(1));

      legendRow.append(partyLink, meter, count, share);
      seatLegend.append(legendRow);
    }
  }

  function renderDirectory() {
    if (!directory) {
      return;
    }

    directory.innerHTML = "";

    const rows = [...state.rows].sort(compareRows);
    if (rows.length === 0) {
      directory.append(buildEmptyState("Ingen partier i oversigten."));
      return;
    }

    for (const row of rows) {
      directory.append(buildPartyRow(row));
    }
  }

  function compareRows(left, right) {
    switch (state.sortMode) {
      case "members_desc":
        return compareMetricRows(left, right, "memberCount");
      case "attendance_desc":
        return compareMetricRows(left, right, "attendanceAvg");
      case "loyalty_desc":
        return compareMetricRows(left, right, "loyaltyAvg");
      case "committee_desc":
        return compareMetricRows(left, right, "committeeAvg");
      case "coverage_desc":
        return compareMetricRows(left, right, "constituencyCount");
      default:
        return collator.compare(left.partyName, right.partyName);
    }
  }

  function compareMetricRows(left, right, key) {
    const leftValue = toNumberOrNull(left[key]);
    const rightValue = toNumberOrNull(right[key]);
    if (leftValue === null && rightValue === null) {
      return collator.compare(left.partyName, right.partyName);
    }
    if (leftValue === null) {
      return 1;
    }
    if (rightValue === null) {
      return -1;
    }
    return rightValue - leftValue || collator.compare(left.partyName, right.partyName);
  }

  function highestRow(rows, key) {
    const comparable = rows.filter((row) => toNumberOrNull(row[key]) !== null);
    if (comparable.length === 0) {
      return null;
    }
    return [...comparable].sort((left, right) => {
      return compareMetricRows(left, right, key);
    })[0];
  }

  function buildPartyRow(row) {
    const article = document.createElement("article");
    article.className = "party-row";

    const head = document.createElement("div");
    head.className = "party-row-head";

    const identity = document.createElement("div");
    identity.className = "party-row-identity";

    const nameLink = document.createElement("a");
    nameLink.className = "party-row-name";
    nameLink.href = row.discoverUrl;

    const badge = buildPartyBadge(row.shortName, row.shortName || row.partyName);
    const name = document.createElement("strong");
    name.textContent = row.partyName;

    nameLink.append(badge, name);

    const kicker = document.createElement("p");
    kicker.className = "party-row-kicker";
    kicker.textContent = `${window.Folkevalget.formatNumber(row.memberCount)} ${pluralize(row.memberCount, "medlem", "medlemmer")}`;

    identity.append(nameLink, kicker);

    const action = document.createElement("a");
    action.className = "party-section-link";
    action.href = row.discoverUrl;
    action.textContent = "Se profiler";

    head.append(identity, action);

    const tags = document.createElement("div");
    tags.className = "context-tag-row";
    if (row.ministerCount > 0) {
      tags.append(buildTag("context-tag context-tag-minister", `${window.Folkevalget.formatNumber(row.ministerCount)} ministre`));
    }
    if (row.northAtlanticCount > 0) {
      tags.append(
        buildTag(
          "context-tag context-tag-north-atlantic",
          `${window.Folkevalget.formatNumber(row.northAtlanticCount)} nordatlantiske`
        )
      );
    }

    const metrics = document.createElement("div");
    metrics.className = "party-row-metrics";
    metrics.append(
      buildMetric("Mandater", window.Folkevalget.formatNumber(row.memberCount)),
      buildMetric("Gns. fremmøde", window.Folkevalget.formatPercent(row.attendanceAvg)),
      buildMetric("Partiloyalitet", window.Folkevalget.formatPercent(row.loyaltyAvg)),
      buildMetric("Udvalg pr. medlem", formatDecimal(row.committeeAvg)),
      buildMetric("Storkredse", window.Folkevalget.formatNumber(row.constituencyCount))
    );

    const note = document.createElement("p");
    note.className = "party-row-note";
    note.textContent = `Gennemsnitlig anciennitet: ${formatYears(row.seniorityAvg)}.`;

    article.append(head);
    if (tags.childElementCount > 0) {
      article.append(tags);
    }
    article.append(metrics, note);
    return article;
  }

  function buildPartyBadge(shortName, fallback) {
    const badge = document.createElement("span");
    badge.className = "party-code-badge";
    badge.textContent = shortName || fallback;
    if (shortName) {
      badge.dataset.party = shortName;
    }
    return badge;
  }

  function buildTag(className, text) {
    const tag = document.createElement("span");
    tag.className = className;
    tag.textContent = text;
    return tag;
  }

  function buildMetric(label, value) {
    const item = document.createElement("div");
    item.className = "party-row-metric";

    const title = document.createElement("span");
    title.className = "signal-label";
    title.textContent = label;

    const number = document.createElement("strong");
    number.textContent = value;

    item.append(title, number);
    return item;
  }

  function buildEmptyState(text) {
    const node = document.createElement("p");
    node.className = "party-empty";
    node.textContent = text;
    return node;
  }

  function formatDecimal(value) {
    if (value === null || value === undefined) {
      return "–";
    }
    return new Intl.NumberFormat("da-DK", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  }

  function formatYears(value) {
    if (value === null || value === undefined) {
      return "–";
    }
    const formatted = formatDecimal(value);
    return `${formatted} år`;
  }

  function pluralize(count, singular, plural) {
    return Number(count) === 1 ? singular : plural;
  }

  function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function countDistinctConstituencies(profiles) {
    return new Set(
      (Array.isArray(profiles) ? profiles : [])
        .filter((profile) => Boolean(profile?.current_party) && Boolean(window.Folkevalget.profileConstituencyLabel(profile)))
        .map((profile) => window.Folkevalget.profileConstituencyLabel(profile))
        .filter(Boolean)
    ).size;
  }

  function renderInsightList(root, rows, mapRow, emptyText) {
    if (!root) {
      return;
    }
    root.innerHTML = "";

    if (!Array.isArray(rows) || rows.length === 0) {
      root.innerHTML = `<div class="panel-empty">${emptyText}</div>`;
      return;
    }

    for (const row of rows) {
      const item = mapRow(row);
      root.append(buildInsightItem(item));
    }
  }

  function buildInsightItem(item) {
    const article = document.createElement("article");
    article.className = "insight-item";

    const head = document.createElement("div");
    head.className = "insight-item-head";

    const link = document.createElement("a");
    link.className = "insight-item-title";
    link.href = item.href || "#";
    link.textContent = item.title || "Uden titel";
    if (String(item.href || "").startsWith("http")) {
      link.target = "_blank";
      link.rel = "noreferrer";
    }
    head.append(link);
    article.append(head);

    const metaParts = Array.isArray(item.meta) ? item.meta.filter(Boolean) : [];
    if (metaParts.length > 0) {
      const meta = document.createElement("div");
      meta.className = "insight-item-meta";
      for (const part of metaParts) {
        const span = document.createElement("span");
        span.textContent = part;
        meta.append(span);
      }
      article.append(meta);
    }

    if (item.note) {
      const note = document.createElement("p");
      note.className = "insight-item-note";
      note.textContent = item.note;
      article.append(note);
    }

    return article;
  }

  return { boot };
})();

PartiesApp.boot().catch((error) => {
  console.error(error);
  const directory = document.querySelector("#party-directory");
  const highlights = document.querySelector("#party-highlight-grid");
  const activityHighlights = document.querySelector("#party-activity-highlights");
  const splitFeed = document.querySelector("#party-split-feed");
  const topicFeed = document.querySelector("#party-topic-feed");
  const composition = document.querySelector("#party-seat-distribution");
  if (highlights) {
    highlights.innerHTML = '<p class="party-empty">Partioversigten kunne ikke indlæses.</p>';
  }
  if (activityHighlights) {
    activityHighlights.innerHTML = '<p class="party-empty">Aktivitetslaget kunne ikke indlæses.</p>';
  }
  if (splitFeed) {
    splitFeed.innerHTML = '<div class="panel-empty">Partisplits kunne ikke indlæses.</div>';
  }
  if (topicFeed) {
    topicFeed.innerHTML = '<div class="panel-empty">Emneord kunne ikke indlæses.</div>';
  }
  if (composition) {
    composition.innerHTML = '<p class="party-empty">Mandatfordelingen kunne ikke indlæses.</p>';
  }
  if (directory) {
    directory.innerHTML = '<p class="party-empty">Partioversigten kunne ikke indlæses.</p>';
  }
});
