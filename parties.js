const PartiesApp = (() => {
  const state = {
    rows: [],
    sortMode: "members_desc",
  };

  const statsRoot = document.querySelector("[data-site-stats]");
  const sortSelect = document.querySelector("#party-sort");
  const tableBody = document.querySelector("#party-table-body");
  const rowTemplate = document.querySelector("#party-row-template");
  const partyCount = document.querySelector("#party-count");
  const memberCount = document.querySelector("#member-count");
  const ministerCount = document.querySelector("#minister-count");

  async function boot() {
    hydrateStateFromQuery();
    const bootstrapParties = Array.isArray(window.Folkevalget.readBootstrapPayload()?.parties)
      ? window.Folkevalget.readBootstrapPayload().parties
      : null;

    const [{ profiles, stats }, parties] = await Promise.all([
      window.Folkevalget.loadCatalogueData(),
      bootstrapParties ? Promise.resolve(bootstrapParties) : window.Folkevalget.fetchJson("data/partier.json"),
    ]);

    state.rows = buildPartyRows(profiles, parties);

    window.Folkevalget.renderStats(statsRoot, stats);
    syncControls();
    bindEvents();
    renderSummary();
    renderTable();
  }

  function hydrateStateFromQuery() {
    const params = new URLSearchParams(window.location.search);
    state.sortMode = params.get("sort") || "members_desc";
  }

  function syncControls() {
    sortSelect.value = state.sortMode;
  }

  function bindEvents() {
    sortSelect.addEventListener("change", (event) => {
      state.sortMode = event.target.value;
      renderTable();
      syncQueryString();
    });
  }

  function syncQueryString() {
    const params = new URLSearchParams();
    if (state.sortMode !== "members_desc") {
      params.set("sort", state.sortMode);
    }
    const next = params.toString() ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState({}, "", next);
  }

  function buildPartyRows(profiles, partyEntries) {
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    const groupedParties = new Map();

    for (const entry of partyEntries) {
      const key = entry.short_name || entry.name;
      if (!groupedParties.has(key)) {
        groupedParties.set(key, {
          shortName: entry.short_name || "",
          rawNames: new Set(),
          memberIds: new Set(),
        });
      }

      const group = groupedParties.get(key);
      if (entry.name) {
        group.rawNames.add(entry.name);
      }
      for (const memberId of entry.member_ids || []) {
        group.memberIds.add(memberId);
      }
    }

    return [...groupedParties.values()]
      .map((group) => {
        const members = [...group.memberIds].map((memberId) => profilesById.get(memberId)).filter(Boolean);
        if (members.length === 0) {
          return null;
        }

        const partyName = resolvePartyName(group.shortName, [...group.rawNames], members);
        return {
          shortName: group.shortName,
          partyName,
          displayName: window.Folkevalget.partyDisplayName(partyName, group.shortName),
          memberCount: members.length,
          attendanceAvg: averageMetric(members.map((member) => member.attendance_pct)),
          loyaltyAvg: averageMetric(members.map((member) => member.party_loyalty_pct)),
          committeeAvg: averageMetric(members.map((member) => (member.committees || []).length)),
          ministerCount: members.filter((member) => window.Folkevalget.isCurrentMinister(member)).length,
          northAtlanticCount: members.filter((member) => window.Folkevalget.isNorthAtlanticMandate(member)).length,
          discoverUrl: buildDiscoverUrl(group.shortName),
        };
      })
      .filter(Boolean);
  }

  function resolvePartyName(shortName, rawNames, members) {
    if (shortName === "UFG") {
      return window.Folkevalget.PARTY_NAMES[shortName];
    }

    const memberName = members.find((member) => member.current_party || member.party);
    if (memberName?.current_party) {
      return memberName.current_party;
    }
    if (memberName?.party) {
      return memberName.party;
    }

    const namedEntry = rawNames.find((name) => !/uden for folketingsgrupperne/i.test(name));
    return namedEntry || window.Folkevalget.PARTY_NAMES[shortName] || shortName || "Ukendt parti";
  }

  function averageMetric(values) {
    const comparableValues = values
      .map((value) => (value === null || value === undefined ? null : Number(value)))
      .filter((value) => value !== null && Number.isFinite(value));

    if (comparableValues.length === 0) {
      return null;
    }

    const sum = comparableValues.reduce((total, value) => total + value, 0);
    return Number((sum / comparableValues.length).toFixed(1));
  }

  function buildDiscoverUrl(shortName) {
    const params = new URLSearchParams();
    if (shortName) {
      params.set("party", shortName);
    }
    return `${window.Folkevalget.toSiteUrl("discover.html")}?${params.toString()}`;
  }

  function renderSummary() {
    partyCount.textContent = window.Folkevalget.formatNumber(state.rows.length);
    memberCount.textContent = window.Folkevalget.formatNumber(
      state.rows.reduce((total, row) => total + row.memberCount, 0)
    );
    ministerCount.textContent = window.Folkevalget.formatNumber(
      state.rows.reduce((total, row) => total + row.ministerCount, 0)
    );
  }

  function renderTable() {
    tableBody.innerHTML = "";

    const sortedRows = [...state.rows].sort(compareRows);
    for (const row of sortedRows) {
      const tableRow = rowTemplate.content.firstElementChild.cloneNode(true);
      renderPartyCell(tableRow.querySelector("[data-cell='party']"), row);
      tableRow.querySelector("[data-cell='members']").textContent = window.Folkevalget.formatNumber(row.memberCount);
      tableRow.querySelector("[data-cell='attendance']").append(buildMetricBlock(row.attendanceAvg, "attendance"));
      tableRow.querySelector("[data-cell='loyalty']").append(buildMetricBlock(row.loyaltyAvg, "loyalty"));
      tableRow.querySelector("[data-cell='committees']").textContent = formatDecimal(row.committeeAvg);
      tableRow.querySelector("[data-cell='link']").href = row.discoverUrl;
      tableBody.append(tableRow);
    }
  }

  function compareRows(left, right) {
    if (state.sortMode === "attendance_desc") {
      return compareMetricRows(left, right, "attendanceAvg", "desc");
    }
    if (state.sortMode === "attendance_asc") {
      return compareMetricRows(left, right, "attendanceAvg", "asc");
    }
    if (state.sortMode === "loyalty_desc") {
      return compareMetricRows(left, right, "loyaltyAvg", "desc");
    }
    if (state.sortMode === "loyalty_asc") {
      return compareMetricRows(left, right, "loyaltyAvg", "asc");
    }
    if (state.sortMode === "name") {
      return left.displayName.localeCompare(right.displayName, "da");
    }

    return right.memberCount - left.memberCount || left.displayName.localeCompare(right.displayName, "da");
  }

  function compareMetricRows(left, right, key, direction) {
    const leftValue = left[key];
    const rightValue = right[key];
    const leftMissing = leftValue === null || leftValue === undefined;
    const rightMissing = rightValue === null || rightValue === undefined;

    if (leftMissing && rightMissing) {
      return left.displayName.localeCompare(right.displayName, "da");
    }
    if (leftMissing) {
      return 1;
    }
    if (rightMissing) {
      return -1;
    }

    const delta = direction === "desc" ? rightValue - leftValue : leftValue - rightValue;
    return delta !== 0 ? delta : left.displayName.localeCompare(right.displayName, "da");
  }

  function renderPartyCell(root, row) {
    const wrap = document.createElement("div");
    wrap.className = "party-overview";

    const pill = document.createElement("span");
    pill.className = "party-pill party-pill-wide";
    pill.dataset.party = row.shortName || "";
    pill.textContent = row.displayName;

    const meta = document.createElement("div");
    meta.className = "party-overview-meta";

    if (row.ministerCount > 0) {
      const tag = document.createElement("span");
      tag.className = "context-tag context-tag-minister";
      tag.textContent = `${window.Folkevalget.formatNumber(row.ministerCount)} ministre`;
      meta.append(tag);
    }

    if (row.northAtlanticCount > 0) {
      const tag = document.createElement("span");
      tag.className = "context-tag context-tag-north-atlantic";
      tag.textContent = `${window.Folkevalget.formatNumber(row.northAtlanticCount)} nordatlantisk`;
      meta.append(tag);
    }

    wrap.append(pill);
    if (meta.childElementCount > 0) {
      wrap.append(meta);
    }
    root.append(wrap);
  }

  function buildMetricBlock(value, kind) {
    const block = document.createElement("div");
    block.className = "table-metric";
    block.dataset.tone = window.Folkevalget.metricTone(value, kind);

    const valueNode = document.createElement("strong");
    valueNode.textContent = window.Folkevalget.formatPercent(value);

    const track = document.createElement("div");
    track.className = "mini-metric-track";

    const fill = document.createElement("span");
    fill.className = "mini-metric-fill";
    fill.style.width = `${window.Folkevalget.clampPercent(value)}%`;

    track.append(fill);
    block.append(valueNode, track);
    return block;
  }

  function formatDecimal(value) {
    if (value === null || value === undefined) {
      return "-";
    }
    return new Intl.NumberFormat("da-DK", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  }

  return { boot };
})();

PartiesApp.boot().catch((error) => {
  console.error(error);
  const tableBody = document.querySelector("#party-table-body");
  if (tableBody) {
    tableBody.innerHTML = '<tr><td colspan="6"><div class="panel-empty">Kunne ikke indlæse partioversigten.</div></td></tr>';
  }
});
