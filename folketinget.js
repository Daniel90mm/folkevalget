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
      insights.recentActivity.latestVotes,
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
      insights.recentActivity.latestMeetings,
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
      insights.process.recentCases,
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
        insights.process.openCases,
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

    renderActivityList(
      elements.hotCommittees,
      insights.committees.topRecent,
      (committee) => ({
        title: `${committee.shortName} · ${committee.name}`,
        href: committee.membersUrl,
        meta: [
          `${api.formatNumber(committee.recentMeetingCount180)} møder`,
          `${api.formatNumber(committee.recentAgendaPointCount180)} dagsordenspunkter`,
          `${api.formatNumber(committee.memberCount)} medlemmer`,
        ],
        note: committee.latestMeeting
          ? `Senest ${api.formatDate(committee.latestMeeting.date)}`
          : null,
      }),
      "Ingen udvalg med registreret aktivitet i den aktuelle periode."
    );

    renderActivityList(
      elements.topicsList,
      insights.topics.recentTopics,
      (topic) => ({
        title: topic.displayLabel,
        href: topic.href,
        meta: [
          `${api.formatNumber(topic.voteCount)} afstemninger`,
          `${api.formatNumber(topic.caseCount)} sager`,
        ],
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
    setText(
      elements.committeeSummary,
      `${api.formatNumber(committees.length)} udvalg med nuværende medlemmer, heraf ${api.formatNumber(activeCommitteeCount)} med registreret mødeaktivitet de seneste 180 dage.`
    );

    for (const committee of committees) {
      const item = document.createElement("article");
      item.className = "parliament-committee-item";

      const main = document.createElement("div");
      main.className = "parliament-committee-main";

      const link = document.createElement("a");
      link.className = "parliament-committee-link";
      link.href = committee.membersUrl;
      link.append(
        buildTextNode("span", "parliament-committee-code", committee.shortName),
        document.createTextNode(committee.name)
      );

      const meta = document.createElement("p");
      meta.className = "parliament-committee-meta";
      meta.textContent =
        `${api.formatNumber(committee.memberCount)} ${pluralize(committee.memberCount, "medlem", "medlemmer")}` +
        ` · ${api.formatNumber(committee.recentMeetingCount180)} ${pluralize(committee.recentMeetingCount180, "møde", "møder")} / 180 dage`;

      main.append(link, meta);

      if (committee.latestMeeting) {
        const note = document.createElement("p");
        note.className = "parliament-activity-note";
        note.textContent = committee.latestAgendaPoint?.sag_number
          ? `Senest ${api.formatDate(committee.latestMeeting.date)} · ${committee.latestAgendaPoint.sag_number}`
          : `Senest ${api.formatDate(committee.latestMeeting.date)}`;
        main.append(note);
      }

      const source = document.createElement("a");
      source.className = "parliament-inline-link";
      source.href = committee.officialUrl || "#";
      source.textContent = "ft.dk";
      source.target = "_blank";
      source.rel = "noreferrer";

      item.append(main, source);
      elements.committeeDirectory.appendChild(item);
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
    root.innerHTML = "";

    if (!Array.isArray(rows) || rows.length === 0) {
      root.append(buildEmptyNode(emptyText));
      return;
    }

    for (const row of rows) {
      const item = document.createElement("div");
      item.className = "status-mix-item";
      item.append(
        buildTextNode("span", "", row.label),
        buildTextNode("strong", "", api.formatNumber(row.count))
      );
      root.append(item);
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
    if (caseNumber && title) {
      return `${caseNumber} · ${title}`;
    }
    return caseNumber || title;
  }

  function agendaPointLabel(count) {
    return `${api.formatNumber(count)} ${pluralize(count, "dagsordenpunkt", "dagsordenspunkter")}`;
  }

  function pluralize(count, singular, plural) {
    return Number(count) === 1 ? singular : plural;
  }
})();
