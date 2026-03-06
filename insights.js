window.FolkevalgetInsights = (() => {
  const api = window.Folkevalget;
  const collator = new Intl.Collator("da-DK");
  const PARTY_COLOR_OVERRIDES = {
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
    SIU: "#326f61",
    SP: "#6f5a16",
    UFG: "#707b75",
    V: "#005da6",
  };
  const FINAL_STATUS_PATTERNS = [
    /stadfaestet/i,
    /vedtaget/i,
    /forkastet/i,
    /bortfaldet/i,
  ];

  let insightsPromise = null;

  async function load() {
    if (insightsPromise) {
      return insightsPromise;
    }

    insightsPromise = buildInsights().catch((error) => {
      insightsPromise = null;
      throw error;
    });
    return insightsPromise;
  }

  async function buildInsights() {
    const [{ profiles, stats }, votes, timelineIndexRows, committeeRows, meetingsPayload] = await Promise.all([
      api.loadCatalogueData(),
      api.loadVoteOverview().catch(() => []),
      api.fetchJson("data/sag_tidslinjer_index.json").catch(() => []),
      api.fetchJson("data/udvalg.json").catch(() => []),
      api.fetchJson("data/moeder.json").catch(() => ({ meetings: [] })),
    ]);

    const currentProfiles = (Array.isArray(profiles) ? profiles : []).filter(isCurrentProfile);
    const currentProfileIds = new Set(
      currentProfiles
        .map((profile) => Number(profile?.id || 0))
        .filter((profileId) => profileId > 0)
    );
    const timelineBySagId = new Map();
    for (const row of Array.isArray(timelineIndexRows) ? timelineIndexRows : []) {
      const sagId = Number(row?.sag_id || 0);
      if (sagId > 0) {
        timelineBySagId.set(sagId, row);
      }
    }

    const partyRows = buildPartyRows(currentProfiles);
    const committeeDirectory = buildCommitteeDirectory(committeeRows, currentProfileIds);
    const normalizedMeetings = normalizeMeetings(meetingsPayload?.meetings, committeeDirectory);
    const normalizedVotes = normalizeVotes(votes, timelineBySagId);
    const anchorDate = latestAnchorDate(normalizedVotes, normalizedMeetings);
    const recentWindows = buildRecentWindows(normalizedVotes, normalizedMeetings, anchorDate);
    const committeeActivity = buildCommitteeActivity(committeeDirectory, normalizedMeetings, anchorDate);
    const topics = buildTopicSummary(normalizedVotes, anchorDate);
    const process = buildProcessSummary(normalizedVotes, normalizedMeetings, timelineBySagId, anchorDate);

    return {
      stats,
      anchorDate,
      currentProfiles,
      partyRows,
      votes: normalizedVotes,
      meetings: normalizedMeetings,
      committees: committeeActivity,
      topics,
      process,
      recentActivity: {
        latestVotes: normalizedVotes.slice(0, 8),
        latestMeetings: normalizedMeetings.slice(0, 8),
        latestVoteDay: normalizedVotes[0]?.date || null,
        latestMeeting: normalizedMeetings[0] || null,
        latestPlenaryMeeting: normalizedMeetings.find((meeting) => meeting.isPlenary) || null,
        latestCommitteeMeeting: normalizedMeetings.find((meeting) => meeting.isCommittee) || null,
        splitVotes: normalizedVotes.filter((vote) => vote.partySplitCount > 0).slice(0, 8),
        closeVotes: normalizedVotes.filter((vote) => vote.isClose).slice(0, 8),
        windows: recentWindows,
      },
    };
  }

  function isCurrentProfile(profile) {
    return Boolean(profile?.current_party) && Boolean(api.profileConstituencyLabel(profile));
  }

  function buildPartyRows(profiles) {
    const grouped = new Map();

    for (const profile of profiles) {
      const shortName = String(profile?.current_party_short || profile?.party_short || "").trim();
      const rawName = String(profile?.current_party || profile?.party || "").trim();
      const key = shortName || rawName;
      if (!key) {
        continue;
      }

      if (!grouped.has(key)) {
        grouped.set(key, {
          shortName,
          rawName,
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
    const constituencySet = new Set(
      members
        .map((member) => api.profileConstituencyLabel(member))
        .filter(Boolean)
    );
    const partyName =
      api.PARTY_NAMES?.[shortName] ||
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
      constituencyCount: constituencySet.size,
      ministerCount: members.filter((member) => api.isCurrentMinister(member)).length,
      northAtlanticCount: members.filter((member) => api.isNorthAtlanticMandate(member)).length,
      discoverUrl: `${api.toSiteUrl("discover.html")}?party=${encodeURIComponent(shortName || partyName)}`,
      color: PARTY_COLOR_OVERRIDES[shortName] || "var(--color-accent)",
    };
  }

  function buildCommitteeDirectory(rows, currentProfileIds) {
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

  function normalizeMeetings(rows, committeeDirectory) {
    const committeesByName = new Map();
    for (const committee of committeeDirectory) {
      committeesByName.set(normalizeCommitteeName(committee.name), committee);
    }

    return (Array.isArray(rows) ? rows : [])
      .map((meeting) => {
        const title = String(meeting?.title || "").trim();
        const type = String(meeting?.type || "").trim();
        const agendaPoints = Array.isArray(meeting?.agenda_points) ? meeting.agenda_points : [];
        const agendaPointCount = Number(meeting?.agenda_point_count || agendaPoints.length || 0);
        const normalizedType = api.normaliseText(type);
        const normalizedTitle = normalizeCommitteeName(title);
        let relatedCommittee = committeesByName.get(normalizedTitle) || null;
        if (!relatedCommittee) {
          relatedCommittee =
            committeeDirectory.find((committee) => normalizedTitle.startsWith(normalizeCommitteeName(committee.name))) ||
            null;
        }

        return {
          meetingId: Number(meeting?.meeting_id || 0) || null,
          date: String(meeting?.date || "").trim() || null,
          number: String(meeting?.number || "").trim() || null,
          title,
          type,
          status: String(meeting?.status || "").trim() || null,
          startNote: String(meeting?.start_note || "").trim() || null,
          agendaUrl: String(meeting?.agenda_url || "").trim() || null,
          agendaPoints,
          agendaPointCount,
          isPlenary: normalizedType.includes("salen"),
          isCommittee: normalizedType.includes("udvalg"),
          relatedCommittee,
          href: buildMeetingUrl(Number(meeting?.meeting_id || 0)),
        };
      })
      .filter((meeting) => meeting.date && meeting.status === "Afholdt")
      .sort(compareMeetingsDesc);
  }

  function normalizeVotes(rows, timelineBySagId) {
    return (Array.isArray(rows) ? rows : [])
      .map((vote) => {
        const sagId = Number(vote?.sag_id || 0) || null;
        const timeline = sagId && timelineBySagId.has(sagId) ? timelineBySagId.get(sagId) : null;
        const labels = Array.isArray(timeline?.emneord?.labels) ? dedupeStrings(timeline.emneord.labels) : [];
        const topicAreas = labels.filter(isTopicAreaLabel);
        const usableTopics = topicAreas.length > 0 ? topicAreas : labels.filter(isTopicLabelUseful);
        const dominantTopic = usableTopics[0] || null;

        return {
          voteId: Number(vote?.afstemning_id || 0) || null,
          number: Number(vote?.nummer || 0) || 0,
          date: String(vote?.date || "").trim() || null,
          passed: Boolean(vote?.vedtaget),
          type: String(vote?.type || "").trim() || "Afstemning",
          caseId: sagId,
          caseNumber: String(vote?.sag_number || "").trim() || null,
          caseTitle: String(vote?.sag_short_title || vote?.sag_title || "").trim() || "Uden titel",
          caseStatus: String(vote?.sagstrin_status || timeline?.sag_status || "").trim() || null,
          partySplitCount: Number(vote?.party_split_count || 0) || 0,
          margin: toNumberOrNull(vote?.margin),
          isClose: toNumberOrNull(vote?.margin) !== null && Number(vote.margin) <= 10,
          topicLabels: labels,
          topicAreas: usableTopics,
          dominantTopic,
          topicDisplay: dominantTopic ? displayTopicLabel(dominantTopic) : null,
          topicHref: dominantTopic ? buildTopicUrl(dominantTopic) : null,
          voteUrl: api.buildVoteUrl(vote?.afstemning_id),
          officialCaseUrl: api.buildSagUrl(vote?.sag_number, vote?.date),
        };
      })
      .filter((vote) => vote.date && vote.voteId)
      .sort(compareVotesDesc);
  }

  function buildRecentWindows(votes, meetings, anchorDate) {
    return {
      7: buildActivityWindow(votes, meetings, anchorDate, 7),
      30: buildActivityWindow(votes, meetings, anchorDate, 30),
      90: buildActivityWindow(votes, meetings, anchorDate, 90),
    };
  }

  function buildActivityWindow(votes, meetings, anchorDate, days) {
    if (!anchorDate) {
      return emptyWindow();
    }

    const start = windowStart(anchorDate, days);
    const voteRows = votes.filter((vote) => isBetween(vote.date, start, anchorDate));
    const meetingRows = meetings.filter((meeting) => isBetween(meeting.date, start, anchorDate));
    const caseIds = new Set(voteRows.map((vote) => vote.caseId).filter(Boolean));
    for (const meeting of meetingRows) {
      for (const point of meeting.agendaPoints) {
        const caseId = Number(point?.sag_id || 0) || null;
        if (caseId) {
          caseIds.add(caseId);
        }
      }
    }

    let referredToCommittee = 0;
    let directToThird = 0;
    let directToSecond = 0;
    let onAgenda = 0;
    for (const meeting of meetingRows) {
      for (const point of meeting.agendaPoints) {
        const status = normalizeStatus(point?.sagstrin_status);
        if (status.includes("henvist til udvalg")) {
          referredToCommittee += 1;
        }
        if (status.includes("direkte til 3. beh")) {
          directToThird += 1;
        }
        if (status.includes("direkte til 2. beh")) {
          directToSecond += 1;
        }
        if (status.includes("paa dagsorden")) {
          onAgenda += 1;
        }
      }
    }

    return {
      days,
      start,
      end: anchorDate,
      votes: voteRows.length,
      meetings: meetingRows.length,
      plenaryMeetings: meetingRows.filter((meeting) => meeting.isPlenary).length,
      committeeMeetings: meetingRows.filter((meeting) => meeting.isCommittee).length,
      closeVotes: voteRows.filter((vote) => vote.isClose).length,
      splitVotes: voteRows.filter((vote) => vote.partySplitCount > 0).length,
      passedVotes: voteRows.filter((vote) => vote.passed).length,
      failedVotes: voteRows.filter((vote) => !vote.passed).length,
      casesTouched: caseIds.size,
      referredToCommittee,
      directToThird,
      directToSecond,
      onAgenda,
    };
  }

  function buildCommitteeActivity(directory, meetings, anchorDate) {
    const rows = directory.map((committee) => ({
      ...committee,
      recentMeetingCount30: 0,
      recentMeetingCount180: 0,
      recentAgendaPointCount30: 0,
      recentAgendaPointCount180: 0,
      latestMeeting: null,
      latestAgendaPoint: null,
    }));
    const byShortName = new Map(rows.map((committee) => [committee.shortName, committee]));
    const start30 = anchorDate ? windowStart(anchorDate, 30) : null;
    const start180 = anchorDate ? windowStart(anchorDate, 180) : null;

    for (const meeting of meetings) {
      const committee = meeting.relatedCommittee?.shortName
        ? byShortName.get(meeting.relatedCommittee.shortName)
        : null;
      if (!committee) {
        continue;
      }

      if (!committee.latestMeeting) {
        committee.latestMeeting = meeting;
        committee.latestAgendaPoint = Array.isArray(meeting.agendaPoints) ? meeting.agendaPoints[0] || null : null;
      }

      if (start180 && isBetween(meeting.date, start180, anchorDate)) {
        committee.recentMeetingCount180 += 1;
        committee.recentAgendaPointCount180 += meeting.agendaPointCount;
      }
      if (start30 && isBetween(meeting.date, start30, anchorDate)) {
        committee.recentMeetingCount30 += 1;
        committee.recentAgendaPointCount30 += meeting.agendaPointCount;
      }
    }

    rows.sort((left, right) => {
      if (right.recentMeetingCount180 !== left.recentMeetingCount180) {
        return right.recentMeetingCount180 - left.recentMeetingCount180;
      }
      if (right.recentAgendaPointCount180 !== left.recentAgendaPointCount180) {
        return right.recentAgendaPointCount180 - left.recentAgendaPointCount180;
      }
      const leftDate = String(left.latestMeeting?.date || "");
      const rightDate = String(right.latestMeeting?.date || "");
      if (leftDate !== rightDate) {
        return rightDate.localeCompare(leftDate);
      }
      return collator.compare(left.name, right.name);
    });

    return {
      directory: rows,
      topRecent: rows.filter((committee) => committee.recentMeetingCount180 > 0).slice(0, 8),
    };
  }

  function buildTopicSummary(votes, anchorDate) {
    if (!anchorDate) {
      return {
        distinctRecentCount: 0,
        recentTopics: [],
      };
    }

    const start90 = windowStart(anchorDate, 90);
    const recentVotes = votes.filter((vote) => isBetween(vote.date, start90, anchorDate));
    const topicMap = new Map();

    for (const vote of recentVotes) {
      const labels = vote.topicAreas.length > 0 ? vote.topicAreas : vote.topicLabels.filter(isTopicLabelUseful);
      const uniqueLabels = dedupeStrings(labels);
      for (const label of uniqueLabels) {
        if (!topicMap.has(label)) {
          topicMap.set(label, {
            label,
            displayLabel: displayTopicLabel(label),
            voteCount: 0,
            caseIds: new Set(),
            latestDate: vote.date,
            href: buildTopicUrl(label),
          });
        }

        const entry = topicMap.get(label);
        entry.voteCount += 1;
        if (vote.caseId) {
          entry.caseIds.add(vote.caseId);
        }
        if (vote.date > entry.latestDate) {
          entry.latestDate = vote.date;
        }
      }
    }

    const recentTopics = [...topicMap.values()]
      .map((entry) => ({
        ...entry,
        caseCount: entry.caseIds.size,
      }))
      .sort((left, right) => {
        if (right.voteCount !== left.voteCount) {
          return right.voteCount - left.voteCount;
        }
        if (right.caseCount !== left.caseCount) {
          return right.caseCount - left.caseCount;
        }
        if (left.latestDate !== right.latestDate) {
          return right.latestDate.localeCompare(left.latestDate);
        }
        return collator.compare(left.displayLabel, right.displayLabel);
      })
      .slice(0, 10);

    return {
      distinctRecentCount: topicMap.size,
      recentTopics,
      leadingTopic: recentTopics[0] || null,
    };
  }

  function buildProcessSummary(votes, meetings, timelineBySagId, anchorDate) {
    const statusCounts = new Map();
    const openCases = [];
    const caseMetaById = buildCaseMetaById(votes, meetings);

    for (const timeline of timelineBySagId.values()) {
      const status = String(timeline?.sag_status || "").trim() || "Ukendt";
      const bucket = classifyCaseStatus(status);
      statusCounts.set(bucket, (statusCounts.get(bucket) || 0) + 1);
      if (!isFinalStatus(status)) {
        const caseId = Number(timeline?.sag_id || 0) || null;
        const meta = caseMetaById.get(caseId) || {};
        openCases.push({
          caseId,
          caseNumber: meta.caseNumber || null,
          caseTitle: meta.caseTitle || "Sag i proces",
          caseStatus: status,
          latestDate: meta.latestDate || null,
          latestEventType: meta.latestEventType || "Sagsforløb",
          topicLabel: meta.topicLabel || firstUsefulTopic(timeline?.emneord?.labels || []),
          topicDisplay: displayTopicLabel(meta.topicLabel || firstUsefulTopic(timeline?.emneord?.labels || [])),
          href: meta.voteId ? api.buildVoteUrl(meta.voteId) : (meta.meetingId ? buildMeetingUrl(meta.meetingId) : api.toSiteUrl("afstemninger.html")),
        });
      }
    }

    openCases.sort((left, right) => {
      const leftDate = String(left.latestDate || "");
      const rightDate = String(right.latestDate || "");
      if (leftDate !== rightDate) {
        return rightDate.localeCompare(leftDate);
      }
      return collator.compare(left.caseTitle, right.caseTitle);
    });

    const statusMix = [
      { key: "stadfaestet", label: "Stadfæstede", count: statusCounts.get("stadfaestet") || 0 },
      { key: "vedtaget", label: "Vedtagne", count: statusCounts.get("vedtaget") || 0 },
      { key: "forkastet", label: "Forkastede", count: statusCounts.get("forkastet") || 0 },
      { key: "delt", label: "Delte", count: statusCounts.get("delt") || 0 },
      { key: "bortfaldet", label: "Bortfaldne", count: statusCounts.get("bortfaldet") || 0 },
      { key: "oevrige", label: "Øvrige", count: statusCounts.get("oevrige") || 0 },
    ].filter((entry) => entry.count > 0);

    const recentCases = buildRecentCaseActivity(votes, meetings, anchorDate);
    const window30 = anchorDate ? buildActivityWindow(votes, meetings, anchorDate, 30) : emptyWindow();

    return {
      statusMix,
      openCases: openCases.slice(0, 8),
      recentCases,
      summary30: {
        casesTouched: window30.casesTouched,
        referredToCommittee: window30.referredToCommittee,
        directToThird: window30.directToThird,
        directToSecond: window30.directToSecond,
        passedVotes: window30.passedVotes,
        failedVotes: window30.failedVotes,
        openCases: openCases.length,
      },
    };
  }

  function buildCaseMetaById(votes, meetings) {
    const map = new Map();

    for (const vote of votes) {
      if (!vote.caseId) {
        continue;
      }

      const existing = map.get(vote.caseId);
      if (!existing || vote.date > existing.latestDate) {
        map.set(vote.caseId, {
          caseNumber: vote.caseNumber,
          caseTitle: vote.caseTitle,
          latestDate: vote.date,
          latestEventType: "Afstemning",
          voteId: vote.voteId,
          meetingId: null,
          topicLabel: vote.dominantTopic || null,
        });
      }
    }

    for (const meeting of meetings) {
      for (const point of meeting.agendaPoints) {
        const caseId = Number(point?.sag_id || 0) || null;
        if (!caseId) {
          continue;
        }

        const eventDate = String(point?.sagstrin_date || meeting.date || "").trim() || null;
        const existing = map.get(caseId);
        if (!existing || String(eventDate || "") > String(existing.latestDate || "")) {
          map.set(caseId, {
            caseNumber: String(point?.sag_number || "").trim() || existing?.caseNumber || null,
            caseTitle: String(point?.sag_title || "").trim() || existing?.caseTitle || "Sag i proces",
            latestDate: eventDate,
            latestEventType: meeting.isCommittee ? "Udvalg" : "Møde",
            voteId: existing?.voteId || null,
            meetingId: meeting.meetingId,
            topicLabel: existing?.topicLabel || null,
          });
        }
      }
    }

    return map;
  }

  function buildRecentCaseActivity(votes, meetings, anchorDate) {
    if (!anchorDate) {
      return [];
    }

    const recentMap = new Map();
    const start = windowStart(anchorDate, 30);

    for (const vote of votes.filter((row) => isBetween(row.date, start, anchorDate))) {
      const key = vote.caseId || vote.caseNumber || vote.voteId;
      if (!key) {
        continue;
      }
      const existing = recentMap.get(key);
      if (!existing || vote.date > existing.latestDate) {
        recentMap.set(key, {
          caseId: vote.caseId,
          caseNumber: vote.caseNumber,
          caseTitle: vote.caseTitle,
          latestDate: vote.date,
          latestEventType: "Afstemning",
          caseStatus: vote.caseStatus,
          topicLabel: vote.dominantTopic || null,
          voteId: vote.voteId,
          meetingId: null,
          officialCaseUrl: vote.officialCaseUrl || null,
        });
      }
    }

    for (const meeting of meetings.filter((row) => isBetween(row.date, start, anchorDate))) {
      for (const point of meeting.agendaPoints) {
        const caseId = Number(point?.sag_id || 0) || null;
        const caseNumber = String(point?.sag_number || "").trim() || null;
        const key = caseId || caseNumber || `${meeting.meetingId}:${point?.agenda_point_id || ""}`;
        if (!key) {
          continue;
        }

        const eventDate = String(point?.sagstrin_date || meeting.date || "").trim() || null;
        const existing = recentMap.get(key);
        if (!existing || String(eventDate || "") > String(existing.latestDate || "")) {
          recentMap.set(key, {
            caseId,
            caseNumber,
            caseTitle: String(point?.sag_title || "").trim() || existing?.caseTitle || "Sag i proces",
            latestDate: eventDate,
            latestEventType: meeting.isCommittee ? "Udvalg" : "Møde",
            caseStatus: String(point?.sagstrin_status || "").trim() || existing?.caseStatus || null,
            topicLabel: existing?.topicLabel || null,
            voteId: existing?.voteId || null,
            meetingId: meeting.meetingId,
            officialCaseUrl: caseNumber ? api.buildSagUrl(caseNumber, eventDate || meeting.date) : null,
          });
        }
      }
    }

    return [...recentMap.values()]
      .sort((left, right) => {
        const leftDate = String(left.latestDate || "");
        const rightDate = String(right.latestDate || "");
        if (leftDate !== rightDate) {
          return rightDate.localeCompare(leftDate);
        }
        return collator.compare(left.caseTitle, right.caseTitle);
      })
      .slice(0, 8)
      .map((item) => ({
        ...item,
        href: item.voteId
          ? api.buildVoteUrl(item.voteId)
          : (item.meetingId ? buildMeetingUrl(item.meetingId) : api.toSiteUrl("afstemninger.html")),
        topicDisplay: item.topicLabel ? displayTopicLabel(item.topicLabel) : null,
      }));
  }

  function latestAnchorDate(votes, meetings) {
    const latestVoteDate = String(votes[0]?.date || "");
    const latestMeetingDate = String(meetings[0]?.date || "");
    if (!latestVoteDate && !latestMeetingDate) {
      return null;
    }
    return latestVoteDate >= latestMeetingDate ? latestVoteDate : latestMeetingDate;
  }

  function compareVotesDesc(left, right) {
    const byDate = String(right?.date || "").localeCompare(String(left?.date || ""));
    if (byDate !== 0) {
      return byDate;
    }
    const byNumber = Number(right?.number || 0) - Number(left?.number || 0);
    if (byNumber !== 0) {
      return byNumber;
    }
    return Number(right?.voteId || 0) - Number(left?.voteId || 0);
  }

  function compareMeetingsDesc(left, right) {
    const byDate = String(right?.date || "").localeCompare(String(left?.date || ""));
    if (byDate !== 0) {
      return byDate;
    }
    const byNumber = Number(right?.number || 0) - Number(left?.number || 0);
    if (byNumber !== 0) {
      return byNumber;
    }
    return Number(right?.meetingId || 0) - Number(left?.meetingId || 0);
  }

  function normalizeCommitteeName(value) {
    return api
      .normaliseText(value)
      .replace(/\s+-\s+.*$/u, "")
      .trim();
  }

  function buildMeetingUrl(meetingId) {
    if (!meetingId) {
      return api.toSiteUrl("moeder.html");
    }
    return `${api.toSiteUrl("moeder.html")}?meeting=${encodeURIComponent(meetingId)}`;
  }

  function buildTopicUrl(label) {
    const params = new URLSearchParams({
      sort: "emneord_asc",
      emneord: label,
    });
    return `${api.toSiteUrl("afstemninger.html")}?${params.toString()}`;
  }

  function isTopicLabelUseful(label) {
    const normalized = api.normaliseText(label);
    return Boolean(normalized) && !normalized.includes("ukontrolleret");
  }

  function isTopicAreaLabel(label) {
    return api.normaliseText(label).endsWith("sagsomraade");
  }

  function displayTopicLabel(label) {
    return String(label || "").replace(/\s*\([^)]*\)\s*$/u, "").trim() || label || "";
  }

  function firstUsefulTopic(labels) {
    return dedupeStrings(Array.isArray(labels) ? labels : []).find(isTopicLabelUseful) || null;
  }

  function classifyCaseStatus(status) {
    const normalized = normalizeStatus(status);
    if (normalized.includes("stadfaestet")) {
      return "stadfaestet";
    }
    if (normalized.includes("vedtaget")) {
      return "vedtaget";
    }
    if (normalized.includes("forkastet")) {
      return "forkastet";
    }
    if (normalized.includes("bortfaldet")) {
      return "bortfaldet";
    }
    if (normalized.includes("delt")) {
      return "delt";
    }
    return "oevrige";
  }

  function isFinalStatus(status) {
    const normalized = normalizeStatus(status);
    return FINAL_STATUS_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  function normalizeStatus(status) {
    return api.normaliseText(status || "");
  }

  function windowStart(anchorDate, days) {
    const date = new Date(`${anchorDate}T00:00:00`);
    date.setDate(date.getDate() - (days - 1));
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function isBetween(value, start, end) {
    const text = String(value || "").trim();
    if (!text || !start || !end) {
      return false;
    }
    return text >= start && text <= end;
  }

  function emptyWindow() {
    return {
      days: 0,
      start: null,
      end: null,
      votes: 0,
      meetings: 0,
      plenaryMeetings: 0,
      committeeMeetings: 0,
      closeVotes: 0,
      splitVotes: 0,
      passedVotes: 0,
      failedVotes: 0,
      casesTouched: 0,
      referredToCommittee: 0,
      directToThird: 0,
      directToSecond: 0,
      onAgenda: 0,
    };
  }

  function averageMetric(values) {
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }
    const sum = values.reduce((total, value) => total + value, 0);
    return Number((sum / values.length).toFixed(1));
  }

  function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function dedupeStrings(values) {
    const seen = new Set();
    const deduped = [];
    for (const value of values) {
      const text = String(value || "").trim();
      if (!text) {
        continue;
      }
      const key = text.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(text);
    }
    return deduped;
  }

  return {
    load,
  };
})();
