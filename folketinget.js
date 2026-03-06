(() => {
  const api = window.Folkevalget;
  const insightsApi = window.FolkevalgetInsights;
  if (!api || !insightsApi) {
    return;
  }

  const elements = {
    statsRoot: document.querySelector("[data-site-stats]"),
    memberCount: document.querySelector("#parliament-member-count"),
    memberMeta: document.querySelector("#parliament-member-meta"),
    groupCount: document.querySelector("#parliament-group-count"),
    groupMeta: document.querySelector("#parliament-group-meta"),
    latestVoteDay: document.querySelector("#parliament-latest-vote-day"),
    latestVoteMeta: document.querySelector("#parliament-latest-vote-meta"),
    latestMeetingDay: document.querySelector("#parliament-latest-meeting-day"),
    latestMeetingMeta: document.querySelector("#parliament-latest-meeting-meta"),
    compositionSummary: document.querySelector("#parliament-composition-summary"),
    seatDistribution: document.querySelector("#parliament-seat-distribution"),
    seatLegend: document.querySelector("#parliament-seat-legend"),
    activity30Votes: document.querySelector("#parliament-activity-30-votes"),
    activity30Meetings: document.querySelector("#parliament-activity-30-meetings"),
    activity90Votes: document.querySelector("#parliament-activity-90-votes"),
    activity90Meetings: document.querySelector("#parliament-activity-90-meetings"),
    latestPlenaryDay: document.querySelector("#parliament-latest-plenary-day"),
    latestPlenaryMeta: document.querySelector("#parliament-latest-plenary-meta"),
    latestCommitteeDay: document.querySelector("#parliament-latest-committee-day"),
    latestCommitteeMeta: document.querySelector("#parliament-latest-committee-meta"),
    latestVotes: document.querySelector("#parliament-latest-votes"),
    latestMeetings: document.querySelector("#parliament-latest-meetings"),
    processOverviewSummary: document.querySelector("#parliament-process-overview-summary"),
    processStrip: document.querySelector("#parliament-process-strip"),
    statusMix: document.querySelector("#parliament-status-mix"),
    recentCases: document.querySelector("#parliament-recent-cases"),
    activeCaseBlock: document.querySelector("#parliament-active-case-block"),
    activeCases: document.querySelector("#parliament-active-cases"),
    topicSummary: document.querySelector("#parliament-topic-summary"),
    hotCommittees: document.querySelector("#parliament-hot-committees"),
    topicsList: document.querySelector("#parliament-topics-list"),
    committeeSummary: document.querySelector("#parliament-committee-summary"),
    committeeDirectory: document.querySelector("#parliament-committee-directory"),
  };

  init().catch((error) => {
    console.error(error);
    setText(elements.memberMeta, "Folketingets overblik kunne ikke indlæses lige nu.");
    if (elements.latestVotes) {
      elements.latestVotes.innerHTML = '<li class="parliament-empty">Afstemninger kunne ikke indlæses.</li>';
    }
    if (elements.latestMeetings) {
      elements.latestMeetings.innerHTML = '<li class="parliament-empty">Møder kunne ikke indlæses.</li>';
    }
    if (elements.recentCases) {
      elements.recentCases.innerHTML = '<li class="parliament-empty">Sagsforløb kunne ikke indlæses.</li>';
    }
    if (elements.topicsList) {
      elements.topicsList.innerHTML = '<li class="parliament-empty">Emneord kunne ikke indlæses.</li>';
    }
  });

  async function init() {
    const insights = await insightsApi.load();
    api.renderStats(elements.statsRoot, insights.stats);
    renderOverview(insights);
    renderComposition(insights.partyRows);
    renderActivity(insights);
    renderProcess(insights);
    renderTopicSection(insights);
    renderCommittees(insights);
  }

  function renderOverview(insights) {
    const latestVoteDate = insights.recentActivity.latestVoteDay;
    const latestVoteCount = latestVoteDate
      ? insights.votes.filter((vote) => vote.date === latestVoteDate).length
      : 0;
    const latestMeeting = insights.recentActivity.latestMeeting;

    setText(elements.memberCount, api.formatNumber(insights.currentProfiles.length));
    setText(elements.memberMeta, "Aktuelle profiler med registreret parti og storkreds.");
    setText(elements.groupCount, api.formatNumber(insights.partyRows.length));
    setText(elements.groupMeta, "Partier, løsgængere og nordatlantiske mandater med mindst ét medlem.");
    setText(elements.latestVoteDay, latestVoteDate ? api.formatDate(latestVoteDate) : "Ingen data");
    setText(
      elements.latestVoteMeta,
      latestVoteDate
        ? `${api.formatNumber(latestVoteCount)} ${pluralize(latestVoteCount, "afstemning", "afstemninger")} registreret den dag.`
        : "Ingen afstemninger i datasættet."
    );
    setText(elements.latestMeetingDay, latestMeeting ? api.formatDate(latestMeeting.date) : "Ingen data");
    setText(
      elements.latestMeetingMeta,
      latestMeeting
        ? `${meetingTitle(latestMeeting)} · ${agendaPointLabel(latestMeeting.agendaPointCount)}`
        : "Ingen møder i datasættet."
    );
  }

  function renderComposition(parties) {
    if (!elements.seatDistribution || !elements.seatLegend) {
      return;
    }

    elements.seatDistribution.replaceChildren();
    elements.seatLegend.replaceChildren();

    const totalMembers = parties.reduce((total, party) => total + party.memberCount, 0);
    if (!totalMembers || parties.length === 0) {
      setText(elements.compositionSummary, "Ingen aktuelle medlemsdata i datasættet.");
      elements.seatDistribution.appendChild(buildEmptyNode("Ingen sammensætning at vise."));
      return;
    }

    setText(
      elements.compositionSummary,
      `${api.formatNumber(totalMembers)} nuværende medlemmer fordelt på ${api.formatNumber(parties.length)} partier og grupper. Listen er alfabetisk.`
    );

    for (const party of parties) {
      const segment = document.createElement("a");
      segment.className = "parliament-seat-segment";
      segment.href = party.discoverUrl;
      segment.title = `${party.partyName}: ${api.formatNumber(party.memberCount)} ${pluralize(party.memberCount, "medlem", "medlemmer")}`;
      segment.setAttribute(
        "aria-label",
        `${party.partyName}: ${api.formatNumber(party.memberCount)} ${pluralize(party.memberCount, "medlem", "medlemmer")}`
      );
      segment.style.flex = `${party.memberCount} 0 0`;
      segment.style.setProperty("--party-color", party.color);
      elements.seatDistribution.appendChild(segment);

      const row = document.createElement("div");
      row.className = "parliament-seat-row";
      row.style.setProperty("--party-color", party.color);

      const partyLink = document.createElement("a");
      partyLink.className = "parliament-seat-party";
      partyLink.href = party.discoverUrl;
      partyLink.append(buildPartyBadge(party.shortName), buildTextNode("span", "parliament-seat-party-name", party.partyName));

      const meter = document.createElement("div");
      meter.className = "parliament-seat-meter";
      const meterFill = document.createElement("span");
      meterFill.className = "parliament-seat-meter-fill";
      meterFill.style.width = `${(party.memberCount / totalMembers) * 100}%`;
      meter.appendChild(meterFill);

      const count = buildTextNode("strong", "parliament-seat-count", api.formatNumber(party.memberCount));
      const share = buildTextNode(
        "span",
        "parliament-seat-share",
        api.formatPercent(((party.memberCount / totalMembers) * 100).toFixed(1))
      );

      row.append(partyLink, meter, count, share);
      elements.seatLegend.appendChild(row);
    }
  }

  function renderActivity(insights) {
    const window30 = insights.recentActivity.windows[30];
    const window90 = insights.recentActivity.windows[90];
    const latestPlenary = insights.recentActivity.latestPlenaryMeeting;
    const latestCommittee = insights.recentActivity.latestCommitteeMeeting;

    setText(elements.activity30Votes, `${api.formatNumber(window30.votes)} ${pluralize(window30.votes, "afstemning", "afstemninger")}`);
    setText(
      elements.activity30Meetings,
      `${api.formatNumber(window30.meetings)} ${pluralize(window30.meetings, "møde", "møder")} · ${api.formatNumber(window30.casesTouched)} sager`
    );
    setText(elements.activity90Votes, `${api.formatNumber(window90.votes)} ${pluralize(window90.votes, "afstemning", "afstemninger")}`);
    setText(
      elements.activity90Meetings,
      `${api.formatNumber(window90.meetings)} ${pluralize(window90.meetings, "møde", "møder")} · ${api.formatNumber(window90.committeeMeetings)} udvalgsmøder`
    );

    setText(elements.latestPlenaryDay, latestPlenary ? api.formatDate(latestPlenary.date) : "Ingen data");
    setText(
      elements.latestPlenaryMeta,
      latestPlenary
        ? `${meetingTitle(latestPlenary)} · ${agendaPointLabel(latestPlenary.agendaPointCount)}`
        : "Ingen plenummøder i datasættet."
    );
    setText(elements.latestCommitteeDay, latestCommittee ? api.formatDate(latestCommittee.date) : "Ingen data");
    setText(
      elements.latestCommitteeMeta,
      latestCommittee
        ? `${meetingTitle(latestCommittee)} · ${agendaPointLabel(latestCommittee.agendaPointCount)}`
        : "Ingen udvalgsmøder i datasættet."
    );

    renderActivityList(
      elements.latestVotes,
      insights.recentActivity.latestVotes.slice(0, 6),
      (vote) => ({
        title: `${vote.caseNumber || `Afstemning ${vote.number}`} · ${vote.caseTitle}`,
        href: vote.voteUrl,
        meta: [
          api.formatDate(vote.date),
          vote.type || null,
          vote.passed ? "Vedtaget" : "Forkastet",
        ],
        note:
          vote.partySplitCount > 0
            ? `${api.formatNumber(vote.partySplitCount)} ${pluralize(vote.partySplitCount, "partisplit", "partisplits")}${vote.topicDisplay ? ` · ${vote.topicDisplay}` : ""}`
            : vote.topicDisplay,
      }),
      "Ingen registrerede afstemninger i datasættet."
    );

    renderActivityList(
      elements.latestMeetings,
      insights.recentActivity.latestMeetings.slice(0, 6),
      (meeting) => ({
        title: meetingTitle(meeting),
        href: meeting.href,
        meta: [
          api.formatDate(meeting.date),
          meeting.type || null,
          agendaPointLabel(meeting.agendaPointCount),
        ],
        note: meeting.relatedCommittee
          ? `${meeting.relatedCommittee.name}`
          : meetingAgendaSummary(meeting),
      }),
      "Ingen registrerede møder i datasættet."
    );
  }

  function renderProcess(insights) {
    const summary30 = insights.process.summary30;
    setText(
      elements.processOverviewSummary,
      `Statuslaget bygger på sagsindekset, mens bevægelserne nedenfor viser sager berørt inden for de seneste 30 dage frem til ${api.formatDate(insights.anchorDate)}.`
    );

    renderParliamentStatStrip(elements.processStrip, [
      {
        label: "Sager berørt, 30 dage",
        value: api.formatNumber(summary30.casesTouched),
        meta: "Unikke sager i møder eller afstemninger",
      },
      {
        label: "Henvist til udvalg",
        value: api.formatNumber(summary30.referredToCommittee),
        meta: "Registrerede udvalgshenvisninger",
      },
      {
        label: "Direkte til 3. beh.",
        value: api.formatNumber(summary30.directToThird),
        meta: "Sager ført videre i processen",
      },
      {
        label: "Åbne eller delte",
        value: api.formatNumber(summary30.openCases),
        meta: "Få sager står som ikke-afsluttede i statuslaget",
      },
    ]);

    renderStatusMix(elements.statusMix, insights.process.statusMix, "Ingen statusfordeling i datasættet.");

    renderActivityList(
      elements.recentCases,
      insights.process.recentCases.slice(0, 6),
      (row) => ({
        title: `${row.caseNumber ? `${row.caseNumber} · ` : ""}${row.caseTitle}`,
        href: row.href,
        meta: [
          row.latestDate ? api.formatDate(row.latestDate) : null,
          row.latestEventType || null,
          row.caseStatus || null,
        ],
        note: row.topicDisplay || null,
      }),
      "Ingen sagsbevægelser i den aktuelle periode."
    );

    const hasActiveCases = insights.process.openCases.length > 0;
    elements.activeCaseBlock?.classList.toggle("hidden", !hasActiveCases);
    if (hasActiveCases) {
      renderActivityList(
        elements.activeCases,
        insights.process.openCases.slice(0, 5),
        (row) => ({
          title: `${row.caseNumber ? `${row.caseNumber} · ` : ""}${row.caseTitle}`,
          href: row.href,
          meta: [
            row.latestDate ? api.formatDate(row.latestDate) : null,
            row.latestEventType || null,
            row.caseStatus || null,
          ],
          note: row.topicDisplay || null,
        }),
        "Ingen åbne eller delte sager i statuslaget."
      );
    }
  }

  function renderTopicSection(insights) {
    setText(
      elements.topicSummary,
      `Udvalgene summeres på de seneste 180 dage, og emnerne bygger på officielle sagsområder koblet til afstemningerne i de seneste 90 dage.`
    );

    renderBarList(
      elements.hotCommittees,
      insights.committees.topRecent.slice(0, 6),
      (committee) => ({
        code: committee.shortName,
        title: committee.name,
        href: committee.membersUrl,
        barValue: committee.recentMeetingCount180,
        valueText: `${api.formatNumber(committee.recentMeetingCount180)} ${pluralize(committee.recentMeetingCount180, "møde", "møder")}`,
        metaText: `${api.formatNumber(committee.recentAgendaPointCount180)} dagsordenspunkter · ${api.formatNumber(committee.memberCount)} medlemmer`,
        note: committee.latestMeeting
          ? `Senest ${api.formatDate(committee.latestMeeting.date)}`
          : null,
      }),
      "Ingen udvalg med registreret aktivitet i den aktuelle periode."
    );

    renderBarList(
      elements.topicsList,
      insights.topics.recentTopics.slice(0, 8),
      (topic) => ({
        title: topic.displayLabel,
        href: topic.href,
        barValue: topic.voteCount,
        valueText: `${api.formatNumber(topic.voteCount)} ${pluralize(topic.voteCount, "afstemning", "afstemninger")}`,
        metaText: `${api.formatNumber(topic.caseCount)} ${pluralize(topic.caseCount, "sag", "sager")}`,
        note: topic.latestDate ? `Senest ${api.formatDate(topic.latestDate)}` : null,
      }),
      "Ingen emneord i den aktuelle periode."
    );
  }

  function renderCommittees(insights) {
    if (!elements.committeeDirectory) {
      return;
    }

    elements.committeeDirectory.replaceChildren();
    const committees = insights.committees.directory;
    if (committees.length === 0) {
      setText(elements.committeeSummary, "Ingen udvalg med nuværende medlemmer i datasættet.");
      elements.committeeDirectory.appendChild(buildEmptyNode("Ingen udvalg at vise."));
      return;
    }

    const activeCommitteeCount = committees.filter((committee) => committee.recentMeetingCount180 > 0).length;
    const maxRecentMeetings = Math.max(1, ...committees.map((committee) => committee.recentMeetingCount180));
    setText(
      elements.committeeSummary,
      `${api.formatNumber(committees.length)} udvalg med nuværende medlemmer, heraf ${api.formatNumber(activeCommitteeCount)} med registreret mødeaktivitet de seneste 180 dage.`
    );

    for (const committee of committees) {
      const row = document.createElement("article");
      row.className = "parliament-committee-row";

      const main = document.createElement("div");
      main.className = "parliament-committee-cell parliament-committee-main";

      const link = document.createElement("a");
      link.className = "parliament-committee-link";
      link.href = committee.membersUrl;
      link.append(
        buildTextNode("span", "parliament-committee-code", committee.shortName),
        buildTextNode("span", "parliament-committee-name", committee.name)
      );
      main.append(link);

      const members = buildTextNode(
        "div",
        "parliament-committee-cell parliament-committee-members",
        api.formatNumber(committee.memberCount)
      );

      const activity = document.createElement("div");
      activity.className = "parliament-committee-cell parliament-committee-activity";
      const activityTrack = document.createElement("div");
      activityTrack.className = "parliament-committee-activity-track";
      const activityFill = document.createElement("span");
      activityFill.className = "parliament-committee-activity-fill";
      activityFill.style.width = `${maxRecentMeetings > 0 ? (committee.recentMeetingCount180 / maxRecentMeetings) * 100 : 0}%`;
      activityTrack.appendChild(activityFill);
      const activityLabel = buildTextNode(
        "span",
        "parliament-committee-activity-label",
        `${api.formatNumber(committee.recentMeetingCount180)} ${pluralize(committee.recentMeetingCount180, "møde", "møder")} / 180 dage`
      );
      activity.append(activityTrack, activityLabel);

      const latest = document.createElement("div");
      latest.className = "parliament-committee-cell parliament-committee-latest";
      latest.textContent = committee.latestMeeting
        ? (committee.latestAgendaPoint?.sag_number
            ? `${api.formatDate(committee.latestMeeting.date)} · ${committee.latestAgendaPoint.sag_number}`
            : api.formatDate(committee.latestMeeting.date))
        : "Ingen registreret aktivitet";

      const source = document.createElement("a");
      source.className = "parliament-inline-link parliament-committee-source";
      source.href = committee.officialUrl || "#";
      source.textContent = "ft.dk";
      source.target = "_blank";
      source.rel = "noreferrer";

      row.append(main, members, activity, latest, source);
      elements.committeeDirectory.appendChild(row);
    }
  }

  function renderParliamentStatStrip(root, items) {
    if (!root) {
      return;
    }
    root.innerHTML = "";

    for (const item of items) {
      const article = document.createElement("article");
      article.className = "parliament-key-stat";

      article.append(
        buildTextNode("span", "parliament-stat-label", item.label),
        buildTextNode("strong", "", item.value),
        buildTextNode("p", "", item.meta)
      );
      root.append(article);
    }
  }

  function renderStatusMix(root, rows, emptyText) {
    if (!root) {
      return;
    }
    root.replaceChildren();

    if (!Array.isArray(rows) || rows.length === 0) {
      root.append(buildEmptyNode(emptyText));
      return;
    }

    const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0) || 1;

    for (const row of rows) {
      const item = document.createElement("div");
      item.className = "status-mix-item";

      const head = document.createElement("div");
      head.className = "status-mix-head";
      const values = document.createElement("div");
      values.className = "status-mix-values";
      values.append(
        buildTextNode("strong", "", api.formatNumber(row.count)),
        buildTextNode("span", "", api.formatPercent(((Number(row.count || 0) / total) * 100).toFixed(1)))
      );
      head.append(buildTextNode("span", "status-mix-label", row.label), values);

      const track = document.createElement("div");
      track.className = "status-mix-track";
      const fill = document.createElement("span");
      fill.className = "status-mix-fill";
      fill.style.width = `${(Number(row.count || 0) / total) * 100}%`;
      track.append(fill);

      item.append(head, track);
      root.append(item);
    }
  }

  function renderBarList(root, rows, mapRow, emptyText) {
    if (!root) {
      return;
    }
    root.replaceChildren();

    if (!Array.isArray(rows) || rows.length === 0) {
      root.appendChild(buildEmptyNode(emptyText, "li"));
      return;
    }

    const items = rows.map((row) => mapRow(row));
    const maxValue = Math.max(1, ...items.map((item) => Number(item.barValue || 0)));

    for (const item of items) {
      root.appendChild(buildBarItem(item, maxValue));
    }
  }

  function renderActivityList(root, rows, mapRow, emptyText) {
    if (!root) {
      return;
    }
    root.replaceChildren();

    if (!Array.isArray(rows) || rows.length === 0) {
      root.appendChild(buildEmptyNode(emptyText, "li"));
      return;
    }

    for (const row of rows) {
      const config = mapRow(row);
      root.appendChild(buildActivityItem(config));
    }
  }

  function buildActivityItem(config) {
    const item = document.createElement("li");
    item.className = "parliament-activity-item";

    const link = document.createElement("a");
    link.className = "parliament-activity-link";
    link.href = config.href || "#";
    link.textContent = config.title || "Uden titel";
    if (String(config.href || "").startsWith("http")) {
      link.target = "_blank";
      link.rel = "noreferrer";
    }
    item.appendChild(link);

    const metaParts = Array.isArray(config.meta) ? config.meta.filter(Boolean) : [];
    if (metaParts.length > 0) {
      const meta = document.createElement("div");
      meta.className = "parliament-activity-meta";
      for (const part of metaParts) {
        const span = document.createElement("span");
        span.textContent = part;
        meta.appendChild(span);
      }
      item.appendChild(meta);
    }

    if (config.note) {
      const note = document.createElement("p");
      note.className = "parliament-activity-note";
      note.textContent = config.note;
      item.appendChild(note);
    }

    return item;
  }

  function buildBarItem(config, maxValue) {
    const item = document.createElement("li");
    item.className = "parliament-bar-item";

    const head = document.createElement("div");
    head.className = "parliament-bar-head";

    let titleNode;
    if (config.href) {
      titleNode = document.createElement("a");
      titleNode.className = "parliament-bar-link";
      titleNode.href = config.href;
      if (String(config.href).startsWith("http")) {
        titleNode.rel = "noreferrer";
        titleNode.target = "_blank";
      }
    } else {
      titleNode = document.createElement("div");
      titleNode.className = "parliament-bar-link";
    }

    if (config.code) {
      titleNode.append(buildTextNode("span", "parliament-bar-code", config.code));
    }
    titleNode.append(buildTextNode("span", "parliament-bar-title", config.title || "Uden titel"));

    const value = buildTextNode("span", "parliament-bar-value", config.valueText || "");
    head.append(titleNode, value);

    const track = document.createElement("div");
    track.className = "parliament-bar-track";
    const fill = document.createElement("span");
    fill.className = "parliament-bar-fill";
    fill.style.width = `${maxValue > 0 ? (Number(config.barValue || 0) / maxValue) * 100 : 0}%`;
    track.appendChild(fill);

    item.append(head, track);

    if (config.metaText) {
      item.appendChild(buildTextNode("p", "parliament-bar-meta", config.metaText));
    }

    if (config.note) {
      item.appendChild(buildTextNode("p", "parliament-bar-note", config.note));
    }

    return item;
  }

  function buildPartyBadge(shortName) {
    const badge = document.createElement("span");
    badge.className = "party-code-badge";
    badge.textContent = shortName || "UFG";
    if (shortName) {
      badge.dataset.party = shortName;
    }
    return badge;
  }

  function buildTextNode(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) {
      node.className = className;
    }
    node.textContent = text;
    return node;
  }

  function buildEmptyNode(text, tagName = "p") {
    const item = document.createElement(tagName);
    item.className = "parliament-empty";
    item.textContent = text;
    return item;
  }

  function setText(element, text) {
    if (element) {
      element.textContent = text;
    }
  }

  function meetingTitle(meeting) {
    if (!meeting) {
      return "Ukendt møde";
    }
    if (meeting.isPlenary && meeting.number) {
      return `Møde i salen nr. ${meeting.number}`;
    }
    return meeting.title || meeting.type || "Møde";
  }

  function meetingAgendaSummary(meeting) {
    const firstAgendaPoint = Array.isArray(meeting?.agendaPoints) ? meeting.agendaPoints[0] : null;
    if (!firstAgendaPoint?.sag_number && !firstAgendaPoint?.sag_title) {
      return "";
    }

    const caseNumber = String(firstAgendaPoint.sag_number || "").trim();
    const title = String(firstAgendaPoint.sag_title || "").trim();
    if (caseNumber) {
      return `Første sag: ${caseNumber}`;
    }
    return title ? "Første punkt på dagsordenen" : "";
  }

  function agendaPointLabel(count) {
    return `${api.formatNumber(count)} ${pluralize(count, "dagsordenpunkt", "dagsordenspunkter")}`;
  }

  function pluralize(count, singular, plural) {
    return Number(count) === 1 ? singular : plural;
  }
})();
