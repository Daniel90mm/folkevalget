const HomeApp = (() => {
  const api = window.Folkevalget;
  const insightsApi = window.FolkevalgetInsights;

  const statsRoot = document.querySelector("[data-site-stats]");
  const heroProfileCount = document.querySelector("[data-home='profiles']");
  const heroVoteCount = document.querySelector("[data-home='votes']");
  const heroUpdated = document.querySelector("[data-home='updated']");

  const elements = {
    activitySummary: document.querySelector("#home-activity-summary"),
    activityStrip: document.querySelector("#home-activity-strip"),
    latestVotes: document.querySelector("#home-latest-votes"),
    latestMeetings: document.querySelector("#home-latest-meetings"),
    processSummary: document.querySelector("#home-process-summary"),
    processStrip: document.querySelector("#home-process-strip"),
    statusMix: document.querySelector("#home-status-mix"),
    recentCases: document.querySelector("#home-recent-cases"),
    activeCasesWrap: document.querySelector("#home-active-cases-wrap"),
    activeCases: document.querySelector("#home-active-cases"),
    committeeTopicSummary: document.querySelector("#home-committee-topic-summary"),
    committeeActivity: document.querySelector("#home-committee-activity"),
    topicLayer: document.querySelector("#home-topic-layer"),
  };

  async function boot() {
    const insights = await insightsApi.load();
    api.renderStats(statsRoot, insights.stats);
    renderHeroNumbers(insights.stats);
    renderRecentActivity(insights);
    renderProcess(insights);
    renderCommitteesAndTopics(insights);
  }

  function renderHeroNumbers(stats) {
    heroProfileCount.textContent = api.formatNumber(stats?.counts?.profiles);
    heroVoteCount.textContent = api.formatNumber(stats?.counts?.votes);
    heroUpdated.textContent = api.formatDate(stats?.generated_at);
  }

  function renderRecentActivity(insights) {
    const window7 = insights.recentActivity.windows[7];
    const window30 = insights.recentActivity.windows[30];
    setText(
      elements.activitySummary,
      `Seneste registrerede aktivitet går til ${api.formatDate(insights.anchorDate)}. Her er afstemninger og møder fra de seneste uger i datasættet.`
    );

    renderInsightStrip(elements.activityStrip, [
      {
        label: "Afstemninger, 7 dage",
        value: `${api.formatNumber(window7.votes)}`,
        meta: `${api.formatNumber(window7.casesTouched)} sager berørt`,
      },
      {
        label: "Møder, 30 dage",
        value: `${api.formatNumber(window30.meetings)}`,
        meta: `${api.formatNumber(window30.plenaryMeetings)} i salen · ${api.formatNumber(window30.committeeMeetings)} i udvalg`,
      },
      {
        label: "Tætte afstemninger, 30 dage",
        value: `${api.formatNumber(window30.closeVotes)}`,
        meta: "Ja/nej-margin på højst 10 %",
      },
      {
        label: "Partisplits, 30 dage",
        value: `${api.formatNumber(window30.splitVotes)}`,
        meta: "Afstemninger med intern partiuenighed",
      },
    ]);

    renderInsightList(
      elements.latestVotes,
      insights.recentActivity.latestVotes,
      (vote) => ({
        title: `${vote.caseNumber || `Afstemning ${vote.number}`} · ${vote.caseTitle}`,
        href: vote.voteUrl,
        meta: [
          api.formatDate(vote.date),
          vote.passed ? "Vedtaget" : "Forkastet",
          vote.topicDisplay || null,
        ],
        note:
          vote.partySplitCount > 0
            ? `${api.formatNumber(vote.partySplitCount)} partisplits`
            : null,
      }),
      "Ingen afstemninger i den aktuelle periode."
    );

    renderInsightList(
      elements.latestMeetings,
      insights.recentActivity.latestMeetings,
      (meeting) => ({
        title: meetingTitle(meeting),
        href: meeting.href,
        meta: [
          api.formatDate(meeting.date),
          meeting.type || null,
          `${api.formatNumber(meeting.agendaPointCount)} dagsordenspunkter`,
        ],
        note: meeting.relatedCommittee
          ? `${meeting.relatedCommittee.name}`
          : firstAgendaSummary(meeting),
      }),
      "Ingen møder i den aktuelle periode."
    );
  }

  function renderProcess(insights) {
    const summary30 = insights.process.summary30;
    setText(
      elements.processSummary,
      `Statuslaget bygger på sagstidslinjer, mens bevægelserne nedenfor viser sager berørt inden for de seneste 30 dage frem til ${api.formatDate(insights.anchorDate)}.`
    );

    renderInsightStrip(elements.processStrip, [
      {
        label: "Sager berørt, 30 dage",
        value: `${api.formatNumber(summary30.casesTouched)}`,
        meta: "Unikke sager i møder eller afstemninger",
      },
      {
        label: "Henvist til udvalg",
        value: `${api.formatNumber(summary30.referredToCommittee)}`,
        meta: "Registrerede udvalgshenvisninger",
      },
      {
        label: "Direkte til 3. beh.",
        value: `${api.formatNumber(summary30.directToThird)}`,
        meta: "Sager ført videre uden nyt udvalgsled",
      },
      {
        label: "Åbne eller delte sager",
        value: `${api.formatNumber(summary30.openCases)}`,
        meta: "Statuslaget viser kun få ikke-afsluttede sager",
      },
    ]);

    renderStatusMix(elements.statusMix, insights.process.statusMix, "Ingen statusfordeling i datasættet.");

    renderInsightList(
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
      "Ingen nye sagsbevægelser registreret."
    );

    if (elements.activeCasesWrap) {
      const hasActiveCases = insights.process.openCases.length > 0;
      elements.activeCasesWrap.classList.toggle("hidden", !hasActiveCases);
      if (hasActiveCases) {
        renderInsightList(
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
  }

  function renderCommitteesAndTopics(insights) {
    setText(
      elements.committeeTopicSummary,
      `Udvalg summeres på de seneste 180 dage, og emnerne bygger på officielle sagsområder koblet til afstemningerne i de seneste 90 dage.`
    );

    renderInsightList(
      elements.committeeActivity,
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
        auxiliaryHref: committee.officialUrl,
        auxiliaryLabel: "ft.dk",
      }),
      "Ingen udvalgsmøder i den aktuelle periode."
    );

    renderInsightList(
      elements.topicLayer,
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
      "Ingen gentagne emneord i den aktuelle periode."
    );
  }

  function renderInsightStrip(root, items) {
    if (!root) {
      return;
    }
    root.innerHTML = "";

    for (const item of items) {
      const article = document.createElement("article");
      article.className = "insight-stat";

      const label = document.createElement("span");
      label.className = "insight-stat-label";
      label.textContent = item.label;

      const value = document.createElement("strong");
      value.textContent = item.value;

      const meta = document.createElement("p");
      meta.textContent = item.meta;

      article.append(label, value, meta);
      root.append(article);
    }
  }

  function renderStatusMix(root, rows, emptyText) {
    if (!root) {
      return;
    }
    root.innerHTML = "";

    if (!Array.isArray(rows) || rows.length === 0) {
      root.innerHTML = `<p class="panel-empty">${emptyText}</p>`;
      return;
    }

    for (const row of rows) {
      const item = document.createElement("div");
      item.className = "status-mix-item";

      const label = document.createElement("span");
      label.textContent = row.label;

      const value = document.createElement("strong");
      value.textContent = api.formatNumber(row.count);

      item.append(label, value);
      root.append(item);
    }
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

    const titleLink = document.createElement("a");
    titleLink.className = "insight-item-title";
    titleLink.href = item.href || "#";
    titleLink.textContent = item.title || "Uden titel";
    if (String(item.href || "").startsWith("http")) {
      titleLink.target = "_blank";
      titleLink.rel = "noreferrer";
    }
    head.append(titleLink);

    if (item.auxiliaryHref && item.auxiliaryLabel) {
      const auxiliary = document.createElement("a");
      auxiliary.className = "insight-item-aux";
      auxiliary.href = item.auxiliaryHref;
      auxiliary.target = "_blank";
      auxiliary.rel = "noreferrer";
      auxiliary.textContent = item.auxiliaryLabel;
      head.append(auxiliary);
    }

    article.append(head);

    if (Array.isArray(item.meta) && item.meta.filter(Boolean).length > 0) {
      const meta = document.createElement("div");
      meta.className = "insight-item-meta";
      for (const part of item.meta.filter(Boolean)) {
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

  function meetingTitle(meeting) {
    if (!meeting) {
      return "Ukendt møde";
    }
    if (meeting.isPlenary && meeting.number) {
      return `Møde i salen nr. ${meeting.number}`;
    }
    return meeting.title || meeting.type || "Møde";
  }

  function firstAgendaSummary(meeting) {
    const point = Array.isArray(meeting?.agendaPoints) ? meeting.agendaPoints[0] : null;
    if (!point) {
      return null;
    }
    const caseNumber = String(point?.sag_number || "").trim();
    const caseTitle = String(point?.sag_title || "").trim();
    if (caseNumber && caseTitle) {
      return `${caseNumber} · ${caseTitle}`;
    }
    return caseNumber || caseTitle || null;
  }

  function setText(element, text) {
    if (element) {
      element.textContent = text;
    }
  }

  return { boot };
})();

HomeApp.boot().catch((error) => {
  console.error(error);
  const summary = document.querySelector("#home-activity-summary");
  if (summary) {
    summary.textContent = "Aktivitetslaget kunne ikke indlæses lige nu.";
  }
});
