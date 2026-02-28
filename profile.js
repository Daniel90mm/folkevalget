const ProfileApp = (() => {
  const statsRoot = document.querySelector("[data-site-stats]");
  const emptyState = document.querySelector("#profile-empty");
  const pageContent = document.querySelector("#profile-page");
  const sourceLink = document.querySelector("#profile-source");
  const breadcrumbName = document.querySelector("#breadcrumb-name");
  const profileTags = document.querySelector("#profile-tags");
  const contextNote = document.querySelector("#profile-context-note");
  const photoCredit = document.querySelector("#profile-photo-credit");

  async function boot() {
    const profileId = Number(new URLSearchParams(window.location.search).get("id"));
    const { profiles, stats } = await window.Folkevalget.loadCatalogueData();
    window.Folkevalget.renderStats(statsRoot, stats);

    const profile = profiles.find((entry) => entry.id === profileId) || null;
    if (!profile) {
      renderEmpty();
      return;
    }

    renderProfile(profile);
  }

  function renderEmpty() {
    emptyState.classList.remove("hidden");
    pageContent.classList.add("hidden");
  }

  function renderProfile(profile) {
    emptyState.classList.add("hidden");
    pageContent.classList.remove("hidden");

    document.title = `${profile.name} | Folkevalget`;
    breadcrumbName.textContent = profile.name;

    document.querySelector("#profile-party").textContent = window.Folkevalget.partyDisplayName(
      profile.party,
      profile.party_short
    );
    document.querySelector("#profile-party").dataset.party = profile.party_short || "";
    document.querySelector("#profile-name").textContent = profile.name;
    document.querySelector("#profile-role").textContent =
      [profile.role || "Folketingsmedlem", profile.party].filter(Boolean).join(" · ");
    renderContextTags(profile);
    renderContextNote(profile);
    document.querySelector("#profile-summary").textContent = buildSummary(profile);
    document.querySelector("#profile-vote-total").textContent =
      `${window.Folkevalget.formatNumber(profile.votes_total)} registrerede afstemninger i datasættet`;

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

    renderMetric("attendance", profile.attendance_pct, "attendance");
    renderMetric("loyalty", profile.party_loyalty_pct, "loyalty");
    renderStaticMetric("for", profile.votes_for, "good");
    renderStaticMetric("against", profile.votes_against, "risk");
    renderStaticMetric("absent", profile.votes_absent, "warn");

    renderCommittees(profile.committees || []);
    renderRecentVotes(profile.recent_votes || []);
  }

  function buildSummary(profile) {
    const committeeCount = (profile.committees || []).length;
    return [
      buildSenioritySummary(profile),
      committeeCount > 0 ? `${window.Folkevalget.formatNumber(committeeCount)} aktive udvalg` : "Ingen registrerede udvalg",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function buildSenioritySummary(profile) {
    if (!profile.seniority_label && !profile.member_since_year) {
      return "Anciennitet ikke angivet";
    }

    if (profile.seniority_label && profile.member_since_year) {
      return `${profile.seniority_label} · medlem siden ${profile.member_since_year}`;
    }

    return profile.seniority_label || `Medlem siden ${profile.member_since_year}`;
  }

  function renderMetric(key, value, kind) {
    const metric = document.querySelector(`[data-metric='${key}']`);
    metric.dataset.tone = window.Folkevalget.metricTone(value, kind);
    metric.querySelector("[data-value]").textContent = window.Folkevalget.formatPercent(value);
  }

  function renderStaticMetric(key, value, tone) {
    const metric = document.querySelector(`[data-metric='${key}']`);
    metric.dataset.tone = tone;
    metric.querySelector("[data-value]").textContent = window.Folkevalget.formatNumber(value);
  }

  function renderCommittees(committees) {
    const root = document.querySelector("#committee-grid");
    root.innerHTML = "";

    if (committees.length === 0) {
      root.innerHTML = '<div class="panel-empty">Ingen aktive udvalg registreret for denne profil.</div>';
      return;
    }

    for (const committee of committees) {
      const link = document.createElement("a");
      link.className = "committee-card";
      link.href = window.Folkevalget.buildCommitteeUrl(committee.short_name);
      link.target = "_blank";
      link.rel = "noreferrer";

      const code = document.createElement("strong");
      code.textContent = committee.short_name || "Udvalg";

      const name = document.createElement("span");
      name.textContent = committee.name || committee.short_name || "Ukendt udvalg";

      const note = document.createElement("small");
      note.textContent = "Åbn på ft.dk";

      link.append(code, name, note);
      root.append(link);
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

  function renderRecentVotes(votes) {
    const root = document.querySelector("#vote-feed");
    root.innerHTML = "";

    if (votes.length === 0) {
      root.innerHTML = '<div class="panel-empty">Ingen stemmer registreret i det aktuelle udsnit.</div>';
      return;
    }

    for (const vote of votes) {
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
      title.textContent = vote.sag_title || "Afstemning uden tilknyttet sagsoverskrift";
      const outcome = document.createElement("p");
      outcome.textContent = vote.vedtaget ? "Forslaget blev vedtaget." : "Forslaget faldt eller blev forkastet.";
      body.append(title, outcome);

      const badge = document.createElement("span");
      badge.className = `vote-chip ${window.Folkevalget.voteBadgeClass(vote.vote_type)}`;
      badge.textContent = vote.vote_type || "Ukendt";

      const action = document.createElement("span");
      action.className = "vote-row-action";
      action.textContent = "Se forslag";

      row.append(meta, body, badge, action);
      root.append(row);
    }
  }

  return { boot };
})();

ProfileApp.boot().catch((error) => {
  console.error(error);
  const emptyState = document.querySelector("#profile-empty");
  const content = document.querySelector("#profile-page");
  emptyState.classList.remove("hidden");
  content.classList.add("hidden");
  emptyState.innerHTML = `
    <p class="eyebrow">Fejl</p>
    <h1>Profilen kunne ikke indlæses</h1>
    <p>Prøv igen om et øjeblik eller gå tilbage til oversigten.</p>
    <a class="button-link" href="discover.html">Tilbage til opdag</a>
  `;
});
