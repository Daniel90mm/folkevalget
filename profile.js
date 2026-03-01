const ProfileApp = (() => {
  const statsRoot = document.querySelector("[data-site-stats]");
  const emptyState = document.querySelector("#profile-empty");
  const pageContent = document.querySelector("#profile-page");
  const sourceLink = document.querySelector("#profile-source");
  const breadcrumbName = document.querySelector("#breadcrumb-name");
  const profileTags = document.querySelector("#profile-tags");
  const contextNote = document.querySelector("#profile-context-note");
  const photoCredit = document.querySelector("#profile-photo-credit");
  const attendanceTooltip = document.querySelector("#attendance-tooltip-body");
  const overviewPanel = document.querySelector("#profile-overview-panel");
  const overviewList = document.querySelector("#profile-overview-list");
  const backgroundPanel = document.querySelector("#profile-background-panel");
  const educationBlock = document.querySelector("#profile-education-block");
  const educationList = document.querySelector("#profile-education-list");
  const occupationBlock = document.querySelector("#profile-occupation-block");
  const occupationList = document.querySelector("#profile-occupation-list");
  const historyPanel = document.querySelector("#profile-history-panel");
  const historyList = document.querySelector("#profile-history-list");
  const committeePanel = document.querySelector("#profile-committee-panel");
  const hvervPanel = document.querySelector("#profile-hverv-panel");
  const hvervBody = document.querySelector("#profile-hverv-body");
  const hvervSourceNote = document.querySelector("#profile-hverv-source-note");
  const sectionGrids = Array.from(document.querySelectorAll(".profile-section-grid"));

  async function boot() {
    const profileId = Number(new URLSearchParams(window.location.search).get("id"));
    const [{ profiles, stats }, hvervData] = await Promise.all([
      window.Folkevalget.loadCatalogueData(),
      window.Folkevalget.fetchJson("data/hverv.json").catch(() => null),
    ]);
    window.Folkevalget.renderStats(statsRoot, stats);

    const profile = profiles.find((entry) => entry.id === profileId) || null;
    if (!profile) {
      renderEmpty();
      return;
    }

    renderProfile(profile, hvervData);
  }

  function renderEmpty() {
    emptyState.classList.remove("hidden");
    pageContent.classList.add("hidden");
  }

  function renderProfile(profile, hvervData) {
    emptyState.classList.add("hidden");
    pageContent.classList.remove("hidden");

    document.title = `${profile.name} | Folkevalget`;
    breadcrumbName.textContent = profile.name;

    const partyBadge = document.querySelector("#profile-party");
    partyBadge.textContent = profile.party_short || profile.party || "UP";
    partyBadge.dataset.party = profile.party_short || "";

    document.querySelector("#profile-name").textContent = profile.name;
    document.querySelector("#profile-role").textContent =
      [profile.role || "Folketingsmedlem", profile.party].filter(Boolean).join(" · ");

    document.querySelector("#profile-summary").textContent = buildSummary(profile);
    document.querySelector("#profile-vote-total").textContent =
      `${window.Folkevalget.formatNumber(profile.votes_total)} registrerede afstemninger i datasættet`;

    renderContextTags(profile);
    renderContextNote(profile);

    if (profile.member_url) {
      sourceLink.href = profile.member_url;
      sourceLink.classList.remove("hidden");
    } else {
      sourceLink.classList.add("hidden");
      sourceLink.removeAttribute("href");
    }

    window.Folkevalget.applyPhoto(
      document.querySelector("#profile-photo"),
      document.querySelector("#profile-initials"),
      profile.photo_url,
      profile.name,
      window.Folkevalget.photoCreditText(profile)
    );
    renderPhotoCredit(profile);
    renderAttendanceTooltip(profile);

    renderMetric("attendance", window.Folkevalget.formatPercent(profile.attendance_pct));
    renderMetric("for", window.Folkevalget.formatNumber(profile.votes_for));
    renderMetric("against", window.Folkevalget.formatNumber(profile.votes_against));
    renderMetric("absent", window.Folkevalget.formatNumber(profile.votes_absent));

    renderOverview(profile);
    renderBackground(profile);
    renderHistory(profile);
    renderCommittees(profile.committees || []);
    renderHverv(profile, hvervData);
    renderRecentVotes(profile.recent_votes || []);
    updateSectionGrids();
  }

  function buildSummary(profile) {
    const committeeCount = (profile.committees || []).length;
    return [
      buildSenioritySummary(profile),
      profile.storkreds ? `valgt i ${profile.storkreds}` : null,
      committeeCount > 0 ? `${window.Folkevalget.formatNumber(committeeCount)} aktive udvalg` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function buildSenioritySummary(profile) {
    if (!profile.seniority_label && !profile.member_since_year) {
      return "Anciennitet ikke angivet";
    }

    if (profile.seniority_label && profile.member_since_year) {
      return `${formatSeniorityLabel(profile.seniority_label)} · medlem siden ${profile.member_since_year}`;
    }

    return formatSeniorityLabel(profile.seniority_label) || `Medlem siden ${profile.member_since_year}`;
  }

  function formatSeniorityLabel(label) {
    if (!label) {
      return label;
    }
    return label.replace(/\baar\b/gi, "år");
  }

  function renderMetric(key, text) {
    const metric = document.querySelector(`[data-metric='${key}']`);
    if (!metric) {
      return;
    }
    metric.querySelector("[data-value]").textContent = text;
  }

  function renderOverview(profile) {
    overviewList.innerHTML = "";

    const rows = [
      buildOverviewRow("Storkreds", profile.storkreds || profile.constituency || null),
      buildOverviewRow("Anciennitet", buildSenioritySummary(profile)),
      buildOverviewRow("Kontakt", profile.email ? { type: "email", value: profile.email } : null),
      buildOverviewRow("Telefon", profile.phone ? { type: "phone", value: profile.phone } : null),
      buildOverviewRow("Hjemmeside", profile.website_url ? { type: "link", value: profile.website_url } : null),
      buildOverviewRow("Adresse", profile.address || null),
    ].filter(Boolean);

    overviewPanel.classList.toggle("hidden", rows.length === 0);
    for (const row of rows) {
      overviewList.append(row);
    }
  }

  function buildOverviewRow(label, content) {
    if (!content) {
      return null;
    }

    const row = document.createElement("div");
    row.className = "fact-row";

    const dt = document.createElement("dt");
    dt.textContent = label;

    const dd = document.createElement("dd");
    if (typeof content === "string") {
      dd.textContent = content;
    } else if (content.type === "email") {
      const link = document.createElement("a");
      link.href = `mailto:${content.value}`;
      link.textContent = content.value;
      dd.append(link);
    } else if (content.type === "phone") {
      const link = document.createElement("a");
      link.href = `tel:${String(content.value).replace(/\s+/g, "")}`;
      link.textContent = content.value;
      dd.append(link);
    } else if (content.type === "link") {
      const link = document.createElement("a");
      link.href = content.value;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = content.value;
      dd.append(link);
    } else {
      return null;
    }

    row.append(dt, dd);
    return row;
  }

  function renderBackground(profile) {
    const educations = Array.isArray(profile.educations) ? profile.educations.filter(Boolean) : [];
    const occupations = Array.isArray(profile.occupations) ? profile.occupations.filter(Boolean) : [];

    renderDetailList(educationBlock, educationList, educations);
    renderDetailList(occupationBlock, occupationList, occupations);
    backgroundPanel.classList.toggle("hidden", educations.length === 0 && occupations.length === 0);
  }

  function renderDetailList(block, listNode, items) {
    listNode.innerHTML = "";
    block.classList.toggle("hidden", items.length === 0);

    for (const item of items) {
      const entry = document.createElement("li");
      entry.textContent = item;
      listNode.append(entry);
    }
  }

  function renderHistory(profile) {
    historyList.innerHTML = "";

    const constituencyHistory = Array.isArray(profile.constituency_history)
      ? profile.constituency_history.filter(Boolean)
      : [];
    const partyHistory = Array.isArray(profile.party_history) ? profile.party_history.filter(Boolean) : [];

    if (constituencyHistory.length > 0) {
      historyPanel.classList.remove("hidden");
      for (const entry of constituencyHistory) {
        historyList.append(buildTimelineItem("Officiel medlemsregistrering", entry));
      }
      return;
    }

    if (partyHistory.length <= 1) {
      historyPanel.classList.add("hidden");
      return;
    }

    historyPanel.classList.remove("hidden");
    for (const entry of partyHistory) {
      historyList.append(
        buildTimelineItem(
          formatHistoryRange(entry.start_date, entry.end_date, entry.active),
          window.Folkevalget.partyDisplayName(entry.party, entry.party_short)
        )
      );
    }
  }

  function buildTimelineItem(metaText, titleText) {
    const item = document.createElement("li");
    item.className = "timeline-item";

    const meta = document.createElement("div");
    meta.className = "timeline-meta";
    meta.textContent = metaText;

    const body = document.createElement("div");
    body.className = "timeline-body";

    const title = document.createElement("strong");
    title.textContent = titleText;
    body.append(title);

    item.append(meta, body);
    return item;
  }

  function formatHistoryRange(startDate, endDate, active) {
    const startLabel = startDate ? window.Folkevalget.formatDate(startDate) : "Ukendt start";
    const endLabel = active || !endDate ? "nu" : window.Folkevalget.formatDate(endDate);
    return `${startLabel} - ${endLabel}`;
  }

  function renderCommittees(committees) {
    const root = document.querySelector("#committee-grid");
    root.innerHTML = "";

    committeePanel.classList.toggle("hidden", committees.length === 0);
    if (committees.length === 0) {
      return;
    }

    for (const committee of committees) {
      const item = document.createElement("li");
      item.className = "committee-list-item";

      const link = document.createElement("a");
      link.className = "committee-list-link";
      link.href = window.Folkevalget.buildCommitteeUrl(committee.short_name);
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = committee.name || committee.short_name || "Udvalg";

      item.append(link);

      if (committee.name && committee.short_name) {
        const meta = document.createElement("span");
        meta.className = "committee-list-meta";
        meta.textContent = committee.short_name;
        item.append(meta);
      }

      root.append(item);
    }
  }

  function renderAttendanceTooltip(profile) {
    if (!attendanceTooltip) {
      return;
    }

    const notes = [
      "Andelen af registrerede afstemninger, hvor medlemmet afgav en stemme i stedet for at være fraværende.",
    ];

    if (window.Folkevalget.isNorthAtlanticMandate(profile)) {
      notes.push(
        "Medlemmer valgt i Færøerne og Grønland deltager ikke nødvendigvis i alle afstemninger, så fremmøde skal læses med ekstra kontekst."
      );
    }

    attendanceTooltip.textContent = notes.join(" ");
  }

  function updateSectionGrids() {
    for (const grid of sectionGrids) {
      const visibleChildren = Array.from(grid.children).filter((child) => !child.classList.contains("hidden"));
      grid.dataset.single = visibleChildren.length <= 1 ? "true" : "false";
    }
  }

  function renderContextTags(profile) {
    profileTags.innerHTML = "";
    for (const flag of window.Folkevalget.profileContextFlags(profile)) {
      const tag = document.createElement("span");
      tag.className = `context-tag context-tag-${flag.key}`;
      tag.textContent = flag.label;
      profileTags.append(tag);
    }
  }

  function renderContextNote(profile) {
    const notes = window.Folkevalget.profileContextNotes(profile);
    if (notes.length === 0) {
      contextNote.classList.add("hidden");
      contextNote.innerHTML = "";
      return;
    }

    contextNote.classList.remove("hidden");
    contextNote.innerHTML = notes.map((note) => `<p>${note}</p>`).join("");
  }

  function renderPhotoCredit(profile) {
    const creditText = window.Folkevalget.photoCreditText(profile);
    if (!creditText || !profile.photo_url) {
      photoCredit.classList.add("hidden");
      photoCredit.textContent = "";
      return;
    }

    photoCredit.classList.remove("hidden");
    photoCredit.textContent = `Portrætfoto: ${creditText}`;
  }

  function renderHverv(profile, hvervData) {
    hvervBody.innerHTML = "";
    hvervSourceNote.textContent = "";
    hvervPanel.classList.add("hidden");

    if (!hvervData) return;

    const entry = (hvervData.medlemmer || {})[String(profile.id)];

    // Ingen data for dette MF overhovedet — skjul sektionen
    if (!entry) return;

    // Siden har ingen hverv-sektion (ny MF, eks-MF, Færø/Grønland) — skjul
    if (entry.ingen_hverv_sektion) return;

    hvervPanel.classList.remove("hidden");

    const registreringer = entry.registreringer || [];

    if (registreringer.length === 0) {
      // Tom registrering — vis, men med forklaring (jf. design language 8.3)
      const empty = document.createElement("p");
      empty.className = "panel-empty";
      empty.textContent = "Ikke registreret i Folketingets hvervregister.";
      hvervBody.append(empty);
    } else {
      // Grupper poster efter kategori
      const byKategori = new Map();
      for (const post of registreringer) {
        const kat = post.kategori || "Øvrigt";
        if (!byKategori.has(kat)) byKategori.set(kat, []);
        byKategori.get(kat).push(post.beskrivelse);
      }

      const list = document.createElement("dl");
      list.className = "fact-list hverv-list";

      for (const [kategori, beskrivelser] of byKategori) {
        for (const beskrivelse of beskrivelser) {
          const row = document.createElement("div");
          row.className = "fact-row";

          const dt = document.createElement("dt");
          dt.textContent = kategori;

          const dd = document.createElement("dd");
          dd.textContent = beskrivelse;

          row.append(dt, dd);
          list.append(row);
        }
      }
      hvervBody.append(list);
    }

    // Kilde, dato og frivillighedsforbehold — kombineret én linje med tooltip
    const hentet = entry.hentet ? window.Folkevalget.formatDate(entry.hentet) : null;

    const sourceLink = document.createElement("a");
    sourceLink.href = "https://www.ft.dk/da/medlemmer/hverv-og-oekonomiske-interesser";
    sourceLink.target = "_blank";
    sourceLink.rel = "noreferrer";
    sourceLink.textContent = "Se hvervregisteret på ft.dk";

    const tooltipWrap = document.createElement("span");
    tooltipWrap.className = "tooltip-wrap";
    const tooltipTrigger = document.createElement("span");
    tooltipTrigger.className = "tooltip-trigger";
    tooltipTrigger.tabIndex = 0;
    tooltipTrigger.setAttribute("aria-label", "Om hvervregisteret");
    tooltipTrigger.textContent = "ⓘ";
    const tooltipBody = document.createElement("span");
    tooltipBody.className = "tooltip-body";
    tooltipBody.setAttribute("role", "tooltip");
    tooltipBody.textContent =
      "Hvervregisteret er frivilligt at udfylde. Manglende registreringer er ikke ensbetydende med fraværet af interesser. Data opdateres manuelt, ikke løbende.";
    tooltipWrap.append(tooltipTrigger, tooltipBody);

    hvervSourceNote.textContent = "Kilde: ";
    hvervSourceNote.append(sourceLink);
    if (hentet) hvervSourceNote.append(document.createTextNode(` · Hentet ${hentet} `));
    else hvervSourceNote.append(document.createTextNode(" "));
    hvervSourceNote.append(tooltipWrap);
  }

  function renderRecentVotes(votes) {
    const root = document.querySelector("#vote-feed");
    root.innerHTML = "";

    if (votes.length === 0) {
      root.innerHTML = '<div class="panel-empty">Ingen registrerede afstemninger i datasættet.</div>';
      return;
    }

    for (const vote of votes.slice(0, 10)) {
      const voteUrl = window.Folkevalget.buildVoteUrl(vote.afstemning_id);
      const row = document.createElement("a");
      row.className = "vote-row vote-row-linkable";
      row.href = voteUrl;

      const meta = document.createElement("div");
      meta.className = "vote-row-meta";

      const label = document.createElement("span");
      label.className = "vote-link";
      label.textContent = vote.sag_number || "Afstemning";

      const date = document.createElement("span");
      date.textContent = window.Folkevalget.formatDate(vote.date);
      meta.append(label, date);

      const body = document.createElement("div");
      body.className = "vote-row-body";

      const title = document.createElement("h3");
      title.textContent = vote.sag_title || "Afstemning uden registreret sagsoverskrift";

      const outcome = document.createElement("p");
      outcome.textContent = vote.vedtaget ? "Forslaget blev vedtaget." : "Forslaget blev forkastet.";
      body.append(title, outcome);

      const badge = document.createElement("span");
      badge.className = `vote-chip ${window.Folkevalget.voteBadgeClass(vote.vote_type)}`;
      badge.textContent = vote.vote_type || "Ukendt";

      const action = document.createElement("span");
      action.className = "vote-row-action";
      action.textContent = "Se afstemning";

      row.append(meta, body, badge, action);
      root.append(row);
    }
  }

  return { boot };
})();

ProfileApp.boot().catch((error) => {
  console.error(error);
  const empty = document.querySelector("#profile-empty");
  const content = document.querySelector("#profile-page");
  if (empty) {
    empty.classList.remove("hidden");
  }
  if (content) {
    content.classList.add("hidden");
  }
});
