(() => {
  const api = window.Folkevalget;
  if (!api) {
    return;
  }

  const PARTY_COLORS = {
    ALT: "#218a4d",
    BP: "#4f5f75",
    DD: "#004450",
    DF: "#4f8fc2",
    EL: "#ae5f0d",
    IA: "#266a91",
    JF: "#6d3149",
    KF: "#00583c",
    LA: "#0086ab",
    M: "#6f5493",
    N: "#915a0f",
    RV: "#733280",
    S: "#b51428",
    SF: "#b60063",
    SP: "#6f5a16",
    UFG: "#707b75",
    V: "#005da6",
  };

  const PARTY_NAMES = {
    ALT: "Alternativet",
    BP: "Borgernes Parti",
    DD: "Danmarksdemokraterne",
    DF: "Dansk Folkeparti",
    EL: "Enhedslisten",
    IA: "Inuit Ataqatigiit",
    JF: "Javnaðarflokkurin",
    KF: "Det Konservative Folkeparti",
    LA: "Liberal Alliance",
    M: "Moderaterne",
    N: "Naleraq",
    RV: "Radikale Venstre",
    S: "Socialdemokratiet",
    SF: "Socialistisk Folkeparti",
    SP: "Sambandsflokkurin",
    UFG: "Uden for grupperne",
    V: "Venstre",
  };

  const collator = new Intl.Collator("da-DK");
  const latestVotesLimit = 8;
  const latestMeetingsLimit = 6;

  const elements = {
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
    committeeSummary: document.querySelector("#parliament-committee-summary"),
    committeeDirectory: document.querySelector("#parliament-committee-directory"),
  };

  init();

  async function init() {
    const catalogue = await api.loadCatalogueData().catch(() => ({ profiles: [], stats: null }));
    const [voteRows, committeeRows, meetingsPayload] = await Promise.all([
      api.loadVoteOverview().catch(() => []),
      api.fetchJson("data/udvalg.json").catch(() => []),
      api.fetchJson("data/moeder.json").catch(() => ({ meetings: [] })),
    ]);

    const profiles = Array.isArray(catalogue?.profiles) ? catalogue.profiles : [];
    const currentProfiles = profiles.filter(isCurrentProfile);
    const currentProfileIds = new Set(
      currentProfiles
        .map((profile) => Number(profile?.id || 0))
        .filter((profileId) => profileId > 0)
    );

    const parties = summariseParties(currentProfiles);
    const committees = summariseCommittees(committeeRows, currentProfileIds);
    const meetings = normaliseMeetings(meetingsPayload?.meetings, committees);
    const votes = normaliseVotes(voteRows);

    renderOverview(currentProfiles, parties, votes, meetings);
    renderComposition(currentProfiles.length, parties);
    renderActivity(votes, meetings);
    renderCommittees(committees);
  }

  function isCurrentProfile(profile) {
    return Boolean(profile?.current_party) && Boolean(profile?.storkreds);
  }

  function summariseParties(profiles) {
    const partyMap = new Map();

    for (const profile of profiles) {
      const shortName = String(profile?.current_party_short || profile?.party_short || "").trim();
      const name = String(
        PARTY_NAMES[shortName] ||
          profile?.current_party ||
          profile?.party ||
          shortName ||
          "Uden for grupperne"
      ).trim();
      const key = shortName || name;
      if (!key) {
        continue;
      }

      const existing = partyMap.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }

      partyMap.set(key, {
        shortName,
        name,
        count: 1,
        color: PARTY_COLORS[shortName] || "var(--color-accent)",
        href: `${api.toSiteUrl("discover.html")}?party=${encodeURIComponent(shortName || name)}`,
      });
    }

    return [...partyMap.values()].sort((left, right) => collator.compare(left.name, right.name));
  }

  function summariseCommittees(rows, currentProfileIds) {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .map((committee) => {
        const memberIds = Array.isArray(committee?.member_ids) ? committee.member_ids : [];
        const currentCount = memberIds.reduce((count, memberId) => {
          return count + (currentProfileIds.has(Number(memberId || 0)) ? 1 : 0);
        }, 0);

        return {
          id: Number(committee?.id || 0) || null,
          name: String(committee?.name || "").trim(),
          shortName: String(committee?.short_name || "").trim(),
          memberCount: currentCount,
          membersUrl: `${api.toSiteUrl("discover.html")}?committee=${encodeURIComponent(committee?.short_name || "")}`,
          officialUrl: api.buildCommitteeUrl(committee?.short_name || ""),
        };
      })
      .filter((committee) => committee.name && committee.shortName && committee.memberCount > 0)
      .sort((left, right) => collator.compare(left.name, right.name));
  }

  function normaliseMeetings(rows, committees) {
    if (!Array.isArray(rows)) {
      return [];
    }

    const committeeByName = new Map();
    for (const committee of committees) {
      committeeByName.set(api.normaliseText(committee.name), committee);
    }

    return rows
      .map((meeting) => {
        const title = String(meeting?.title || "").trim();
        const type = String(meeting?.type || "").trim();
        const agendaPointCount = Number(
          meeting?.agenda_point_count ||
            (Array.isArray(meeting?.agenda_points) ? meeting.agenda_points.length : 0) ||
            0
        );
        const normalizedType = api.normaliseText(type);
        const relatedCommittee = committeeByName.get(api.normaliseText(title)) || null;

        return {
          ...meeting,
          title,
          type,
          agendaPointCount,
          isPlenary: normalizedType.includes("salen"),
          isCommittee: normalizedType.includes("udvalg"),
          relatedCommittee,
        };
      })
      .filter((meeting) => meeting?.date && String(meeting?.status || "").trim() === "Afholdt")
      .sort(compareMeetingsDesc);
  }

  function normaliseVotes(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .filter((vote) => vote?.date && vote?.afstemning_id)
      .slice()
      .sort((left, right) => {
        const byDate = String(right.date).localeCompare(String(left.date));
        if (byDate !== 0) {
          return byDate;
        }
        const byNumber = Number(right.nummer || 0) - Number(left.nummer || 0);
        if (byNumber !== 0) {
          return byNumber;
        }
        return Number(right.afstemning_id || 0) - Number(left.afstemning_id || 0);
      });
  }

  function compareMeetingsDesc(left, right) {
    const byDate = String(right?.date || "").localeCompare(String(left?.date || ""));
    if (byDate !== 0) {
      return byDate;
    }

    const leftNumber = Number(left?.number || 0);
    const rightNumber = Number(right?.number || 0);
    if (leftNumber !== rightNumber) {
      return rightNumber - leftNumber;
    }

    return Number(right?.meeting_id || 0) - Number(left?.meeting_id || 0);
  }

  function renderOverview(currentProfiles, parties, votes, meetings) {
    const latestVoteDate = votes.length > 0 ? votes[0].date : null;
    const latestVoteCount = latestVoteDate
      ? votes.filter((vote) => vote.date === latestVoteDate).length
      : 0;
    const latestMeeting = meetings[0] || null;

    setText(elements.memberCount, api.formatNumber(currentProfiles.length));
    setText(elements.memberMeta, "Aktuelle profiler med registreret parti og storkreds.");
    setText(elements.groupCount, api.formatNumber(parties.length));
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

  function renderComposition(totalMembers, parties) {
    if (!elements.seatDistribution || !elements.seatLegend) {
      return;
    }

    elements.seatDistribution.replaceChildren();
    elements.seatLegend.replaceChildren();

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
      segment.href = party.href;
      segment.title = `${party.name}: ${api.formatNumber(party.count)} ${pluralize(party.count, "medlem", "medlemmer")}`;
      segment.setAttribute(
        "aria-label",
        `${party.name}: ${api.formatNumber(party.count)} ${pluralize(party.count, "medlem", "medlemmer")}`
      );
      segment.style.flex = `${party.count} 0 0`;
      segment.style.setProperty("--party-color", party.color);
      elements.seatDistribution.appendChild(segment);

      const row = document.createElement("div");
      row.className = "parliament-seat-row";
      row.style.setProperty("--party-color", party.color);

      const partyLink = document.createElement("a");
      partyLink.className = "parliament-seat-party";
      partyLink.href = party.href;

      const badge = document.createElement("span");
      badge.className = "party-code-badge";
      badge.textContent = party.shortName || "UFG";
      if (party.shortName) {
        badge.dataset.party = party.shortName;
      }

      const name = document.createElement("span");
      name.className = "parliament-seat-party-name";
      name.textContent = party.name;

      partyLink.append(badge, name);

      const meter = document.createElement("div");
      meter.className = "parliament-seat-meter";

      const meterFill = document.createElement("span");
      meterFill.className = "parliament-seat-meter-fill";
      meterFill.style.width = `${(party.count / totalMembers) * 100}%`;

      meter.appendChild(meterFill);

      const count = document.createElement("strong");
      count.className = "parliament-seat-count";
      count.textContent = api.formatNumber(party.count);

      const share = document.createElement("span");
      share.className = "parliament-seat-share";
      share.textContent = api.formatPercent(((party.count / totalMembers) * 100).toFixed(1));

      row.append(partyLink, meter, count, share);
      elements.seatLegend.appendChild(row);
    }
  }

  function renderActivity(votes, meetings) {
    const latestDate = latestActivityDate(votes, meetings);
    const latestPlenary = meetings.find((meeting) => meeting.isPlenary) || null;
    const latestCommittee = meetings.find((meeting) => meeting.isCommittee) || null;
    const thirtyDay = summariseActivityWindow(votes, meetings, latestDate, 30);
    const ninetyDay = summariseActivityWindow(votes, meetings, latestDate, 90);

    setText(elements.activity30Votes, `${api.formatNumber(thirtyDay.votes)} ${pluralize(thirtyDay.votes, "afstemning", "afstemninger")}`);
    setText(elements.activity30Meetings, `${api.formatNumber(thirtyDay.meetings)} ${pluralize(thirtyDay.meetings, "møde", "møder")} registreret.`);
    setText(elements.activity90Votes, `${api.formatNumber(ninetyDay.votes)} ${pluralize(ninetyDay.votes, "afstemning", "afstemninger")}`);
    setText(elements.activity90Meetings, `${api.formatNumber(ninetyDay.meetings)} ${pluralize(ninetyDay.meetings, "møde", "møder")} registreret.`);

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

    renderLatestVotes(votes.slice(0, latestVotesLimit));
    renderLatestMeetings(meetings.slice(0, latestMeetingsLimit));
  }

  function renderLatestVotes(votes) {
    if (!elements.latestVotes) {
      return;
    }

    elements.latestVotes.replaceChildren();

    if (votes.length === 0) {
      elements.latestVotes.appendChild(buildEmptyNode("Ingen registrerede afstemninger i datasættet.", "li"));
      return;
    }

    for (const vote of votes) {
      const item = document.createElement("li");
      item.className = "parliament-activity-item";

      const link = document.createElement("a");
      link.className = "parliament-activity-link";
      link.href = api.buildVoteUrl(vote.afstemning_id);
      link.textContent = `${vote.sag_number || `Afstemning ${vote.nummer || ""}`}`.trim() + ` · ${vote.sag_short_title || vote.sag_title || "Uden titel"}`;

      const meta = document.createElement("div");
      meta.className = "parliament-activity-meta";
      appendMetaPart(meta, api.formatDate(vote.date));
      appendMetaPart(meta, vote.type || "Afstemning");
      appendMetaPart(meta, vote.vedtaget ? "Vedtaget" : "Forkastet");
      if (Number(vote.party_split_count || 0) > 0) {
        appendMetaPart(
          meta,
          `${api.formatNumber(vote.party_split_count)} ${pluralize(Number(vote.party_split_count || 0), "partisplit", "partisplits")}`
        );
      }

      item.append(link, meta);
      elements.latestVotes.appendChild(item);
    }
  }

  function renderLatestMeetings(meetings) {
    if (!elements.latestMeetings) {
      return;
    }

    elements.latestMeetings.replaceChildren();

    if (meetings.length === 0) {
      elements.latestMeetings.appendChild(buildEmptyNode("Ingen registrerede møder i datasættet.", "li"));
      return;
    }

    for (const meeting of meetings) {
      const item = document.createElement("li");
      item.className = "parliament-activity-item";

      const link = document.createElement("a");
      link.className = "parliament-activity-link";
      link.href = meeting.agenda_url || meeting.relatedCommittee?.membersUrl || api.toSiteUrl("moeder.html");
      link.textContent = meetingTitle(meeting);

      const meta = document.createElement("div");
      meta.className = "parliament-activity-meta";
      appendMetaPart(meta, api.formatDate(meeting.date));
      appendMetaPart(meta, meeting.type || "Møde");
      appendMetaPart(meta, agendaPointLabel(meeting.agendaPointCount));

      const noteText = meetingAgendaSummary(meeting);
      item.append(link, meta);
      if (noteText) {
        const note = document.createElement("p");
        note.className = "parliament-activity-note";
        note.textContent = noteText;
        item.appendChild(note);
      }

      elements.latestMeetings.appendChild(item);
    }
  }

  function renderCommittees(committees) {
    if (!elements.committeeDirectory) {
      return;
    }

    elements.committeeDirectory.replaceChildren();

    if (committees.length === 0) {
      setText(elements.committeeSummary, "Ingen udvalg med nuværende medlemmer i datasættet.");
      elements.committeeDirectory.appendChild(buildEmptyNode("Ingen udvalg at vise."));
      return;
    }

    setText(
      elements.committeeSummary,
      `${api.formatNumber(committees.length)} udvalg og arbejdsgrupper med nuværende medlemmer i datasættet.`
    );

    for (const committee of committees) {
      const item = document.createElement("article");
      item.className = "parliament-committee-item";

      const main = document.createElement("div");
      main.className = "parliament-committee-main";

      const link = document.createElement("a");
      link.className = "parliament-committee-link";
      link.href = committee.membersUrl;

      const code = document.createElement("span");
      code.className = "parliament-committee-code";
      code.textContent = committee.shortName;

      const name = document.createElement("span");
      name.textContent = committee.name;

      link.append(code, name);

      const meta = document.createElement("p");
      meta.className = "parliament-committee-meta";
      meta.textContent = `${api.formatNumber(committee.memberCount)} ${pluralize(committee.memberCount, "medlem", "medlemmer")}`;

      main.append(link, meta);

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

  function latestActivityDate(votes, meetings) {
    const latestVoteDate = votes.length > 0 ? String(votes[0].date) : "";
    const latestMeetingDate = meetings.length > 0 ? String(meetings[0].date) : "";
    return latestVoteDate >= latestMeetingDate ? latestVoteDate : latestMeetingDate;
  }

  function summariseActivityWindow(votes, meetings, anchorDate, days) {
    if (!anchorDate) {
      return { votes: 0, meetings: 0 };
    }

    const start = startDateForWindow(anchorDate, days);
    return {
      votes: votes.filter((vote) => vote.date >= start && vote.date <= anchorDate).length,
      meetings: meetings.filter((meeting) => meeting.date >= start && meeting.date <= anchorDate).length,
    };
  }

  function startDateForWindow(anchorDate, days) {
    const date = new Date(`${anchorDate}T00:00:00`);
    date.setDate(date.getDate() - (days - 1));
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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
    const firstAgendaPoint = Array.isArray(meeting?.agenda_points) ? meeting.agenda_points[0] : null;
    if (!firstAgendaPoint?.sag_number && !firstAgendaPoint?.sag_title) {
      return "";
    }

    const caseNumber = String(firstAgendaPoint.sag_number || "").trim();
    const title = String(firstAgendaPoint.sag_title || "").trim();
    if (caseNumber && title) {
      return `${caseNumber} · ${truncate(title, 132)}`;
    }
    return caseNumber || truncate(title, 132);
  }

  function agendaPointLabel(count) {
    return `${api.formatNumber(count)} ${pluralize(count, "dagsordenpunkt", "dagsordenspunkter")}`;
  }

  function pluralize(count, singular, plural) {
    return Number(count) === 1 ? singular : plural;
  }

  function appendMetaPart(container, text) {
    if (!text) {
      return;
    }
    const part = document.createElement("span");
    part.textContent = text;
    container.appendChild(part);
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

  function truncate(text, maxLength) {
    const normalized = String(text || "").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }
})();
