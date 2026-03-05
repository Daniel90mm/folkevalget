const MEETING_INITIAL_VISIBLE = 12;
const MEETING_INCREMENT = 25;
const AGENDA_PREVIEW_LIMIT = 6;

const MeetingsApp = (() => {
  const state = {
    meetings: [],
    scopeNote: "",
    generatedAt: null,
    query: "",
    upcomingVisible: MEETING_INITIAL_VISIBLE,
    recentVisible: MEETING_INITIAL_VISIBLE,
  };

  const statsRoot = document.querySelector("[data-site-stats]");
  const searchInput = document.querySelector("#meeting-search");
  const scopeNote = document.querySelector("#meeting-scope-note");
  const updatedNote = document.querySelector("#meeting-updated-note");
  const upcomingSummary = document.querySelector("#meeting-upcoming-summary");
  const recentSummary = document.querySelector("#meeting-recent-summary");
  const upcomingList = document.querySelector("#meeting-upcoming-list");
  const recentList = document.querySelector("#meeting-recent-list");
  const upcomingMoreButton = document.querySelector("#meeting-upcoming-more");
  const recentMoreButton = document.querySelector("#meeting-recent-more");

  async function boot() {
    const [{ stats }, meetingsPayload] = await Promise.all([
      window.Folkevalget.loadCatalogueData(),
      loadMeetingsPayload(),
    ]);

    window.Folkevalget.renderStats(statsRoot, stats);
    state.meetings = Array.isArray(meetingsPayload?.meetings) ? meetingsPayload.meetings : [];
    state.scopeNote = String(meetingsPayload?.scope_note || "").trim();
    state.generatedAt = meetingsPayload?.generated_at || null;
    bindEvents();
    render();
  }

  async function loadMeetingsPayload() {
    try {
      const payload = await window.Folkevalget.fetchJson("data/moeder.json");
      if (Array.isArray(payload?.meetings)) {
        return payload;
      }
    } catch (error) {}

    try {
      const timelines = await window.Folkevalget.fetchJson("data/sag_tidslinjer.json");
      return buildFallbackMeetingsPayload(Array.isArray(timelines) ? timelines : []);
    } catch (error) {
      return {
        generated_at: null,
        scope_note: "Mødedata kunne ikke indlæses lige nu.",
        meetings: [],
      };
    }
  }

  function buildFallbackMeetingsPayload(timelines) {
    const meetingsById = new Map();
    const seenAgendaKeysByMeeting = new Map();
    const nowIso = new Date().toISOString();

    for (const timeline of timelines) {
      const steps = Array.isArray(timeline?.steps) ? timeline.steps : [];
      for (const step of steps) {
        const agendaItems = Array.isArray(step?.agenda_items) ? step.agenda_items : [];
        for (const agendaItem of agendaItems) {
          const meeting = agendaItem?.meeting || {};
          const meetingId = Number(meeting?.id || 0);
          if (!Number.isFinite(meetingId) || meetingId <= 0) {
            continue;
          }

          if (!meetingsById.has(meetingId)) {
            meetingsById.set(meetingId, {
              meeting_id: meetingId,
              date: meeting?.date || null,
              number: meeting?.number || null,
              title: meeting?.title || null,
              type: meeting?.type || null,
              status: meeting?.status || null,
              start_note: meeting?.start_note || null,
              agenda_url: meeting?.agenda_url || null,
              agenda_points: [],
              agenda_point_count: 0,
            });
          }

          if (!seenAgendaKeysByMeeting.has(meetingId)) {
            seenAgendaKeysByMeeting.set(meetingId, new Set());
          }

          const agendaPointId = Number(agendaItem?.dagsordenspunkt_id || 0);
          const dedupeKey = [
            String(agendaPointId || ""),
            String(agendaItem?.agenda_number || ""),
            String(agendaItem?.agenda_title || ""),
            String(step?.sagstrin_id || ""),
            String(timeline?.sag_id || ""),
          ].join("||");
          if (seenAgendaKeysByMeeting.get(meetingId).has(dedupeKey)) {
            continue;
          }
          seenAgendaKeysByMeeting.get(meetingId).add(dedupeKey);

          meetingsById.get(meetingId).agenda_points.push({
            agenda_point_id: agendaPointId || null,
            agenda_number: agendaItem?.agenda_number || null,
            agenda_title: agendaItem?.agenda_title || null,
            forhandling: agendaItem?.forhandling || null,
            sag_id: Number(timeline?.sag_id || 0) || null,
            sag_number: timeline?.sag_number || null,
            sag_title: timeline?.sag_short_title || timeline?.sag_title || null,
            sagstrin_id: Number(step?.sagstrin_id || 0) || null,
            sagstrin_date: step?.date || null,
            sagstrin_title: step?.title || null,
            sagstrin_type: step?.type || null,
            sagstrin_status: step?.status || null,
            vote_ids: Array.isArray(step?.vote_ids) ? step.vote_ids.filter((id) => Number(id || 0) > 0) : [],
          });
        }
      }
    }

    const meetings = Array.from(meetingsById.values())
      .map((meeting) => ({
        ...meeting,
        agenda_points: meeting.agenda_points.sort(compareAgendaPoints),
        agenda_point_count: meeting.agenda_points.length,
      }))
      .sort(compareMeetingsRecentFirst);

    return {
      generated_at: nowIso,
      scope_note: "Møder bygget lokalt fra sagsforløb, fordi data/moeder.json ikke var tilgængelig.",
      meetings,
    };
  }

  function bindEvents() {
    searchInput?.addEventListener("input", () => {
      state.query = searchInput.value || "";
      state.upcomingVisible = MEETING_INITIAL_VISIBLE;
      state.recentVisible = MEETING_INITIAL_VISIBLE;
      render();
    });

    upcomingMoreButton?.addEventListener("click", () => {
      state.upcomingVisible += MEETING_INCREMENT;
      render();
    });

    recentMoreButton?.addEventListener("click", () => {
      state.recentVisible += MEETING_INCREMENT;
      render();
    });
  }

  function render() {
    const filtered = filterMeetings(state.meetings, state.query);
    const { upcoming, recent } = splitMeetings(filtered);

    renderScope();
    renderUpcoming(upcoming);
    renderRecent(recent);
  }

  function renderScope() {
    if (scopeNote) {
      scopeNote.textContent =
        state.scopeNote ||
        "Viser møder og dagsordenspunkter fra Folketingets ODA-data i det aktuelle datasæt.";
    }

    if (updatedNote) {
      updatedNote.textContent = `Opdateret: ${window.Folkevalget.formatDate(state.generatedAt)}`;
    }
  }

  function renderUpcoming(meetings) {
    const rendered = renderMeetingList(
      upcomingList,
      meetings,
      state.upcomingVisible,
      "Ingen kommende møder matcher den aktuelle søgning."
    );
    renderCountSummary(upcomingSummary, meetings.length, "kommende møder");
    toggleMoreButton(upcomingMoreButton, rendered, meetings.length);
  }

  function renderRecent(meetings) {
    const rendered = renderMeetingList(
      recentList,
      meetings,
      state.recentVisible,
      "Ingen tidligere møder matcher den aktuelle søgning."
    );
    renderCountSummary(recentSummary, meetings.length, "seneste møder");
    toggleMoreButton(recentMoreButton, rendered, meetings.length);
  }

  function renderMeetingList(root, meetings, visibleLimit, emptyMessage) {
    if (!root) {
      return 0;
    }

    root.innerHTML = "";

    if (meetings.length === 0) {
      root.innerHTML = `<div class="panel-empty">${emptyMessage}</div>`;
      return 0;
    }

    const visible = meetings.slice(0, Math.max(0, visibleLimit));
    const fragment = document.createDocumentFragment();
    for (const meeting of visible) {
      fragment.append(buildMeetingRow(meeting));
    }
    root.append(fragment);
    return visible.length;
  }

  function buildMeetingRow(meeting) {
    const article = document.createElement("article");
    article.className = "meeting-item";

    const head = document.createElement("div");
    head.className = "meeting-item-head";

    const meta = document.createElement("p");
    meta.className = "meeting-item-meta";
    meta.textContent = formatMeetingMeta(meeting);
    head.append(meta);

    const agendaUrl = String(meeting?.agenda_url || "").trim();
    if (agendaUrl) {
      const sourceLink = document.createElement("a");
      sourceLink.className = "meeting-source-link";
      sourceLink.href = agendaUrl;
      sourceLink.target = "_blank";
      sourceLink.rel = "noreferrer";
      sourceLink.textContent = "Åbn dagsorden";
      head.append(sourceLink);
    }

    const title = document.createElement("h3");
    title.className = "meeting-item-title";
    title.textContent = String(meeting?.title || "Møde i Folketinget");

    const detailParts = dedupeStrings([
      meeting?.type,
      meeting?.status,
      meeting?.start_note,
    ]);
    const detail = document.createElement("p");
    detail.className = "meeting-item-detail";
    detail.textContent =
      detailParts.length > 0 ? detailParts.join(" · ") : "Ingen supplerende mødeinformation registreret.";

    const agendaList = buildAgendaList(meeting);
    article.append(head, title, detail, agendaList);
    return article;
  }

  function buildAgendaList(meeting) {
    const wrapper = document.createElement("div");
    wrapper.className = "meeting-agenda";

    const points = Array.isArray(meeting?.agenda_points) ? meeting.agenda_points : [];
    if (points.length === 0) {
      wrapper.innerHTML = '<p class="meeting-agenda-empty">Ingen registrerede dagsordenspunkter i dette datasæt.</p>';
      return wrapper;
    }

    const list = document.createElement("ul");
    list.className = "meeting-agenda-list";

    const visiblePoints = points.slice(0, AGENDA_PREVIEW_LIMIT);
    for (const point of visiblePoints) {
      list.append(buildAgendaRow(point, meeting));
    }

    wrapper.append(list);

    if (points.length > visiblePoints.length) {
      const more = document.createElement("p");
      more.className = "meeting-agenda-more";
      more.textContent = `+${window.Folkevalget.formatNumber(points.length - visiblePoints.length)} yderligere dagsordenspunkter.`;
      wrapper.append(more);
    }

    return wrapper;
  }

  function buildAgendaRow(point, meeting) {
    const item = document.createElement("li");
    item.className = "meeting-agenda-item";

    const number = document.createElement("span");
    number.className = "meeting-agenda-number";
    number.textContent = String(point?.agenda_number || "•");

    const copy = document.createElement("div");
    copy.className = "meeting-agenda-copy";

    const title = document.createElement("p");
    title.className = "meeting-agenda-title";
    title.textContent =
      String(point?.agenda_title || point?.sagstrin_title || "Dagsordenspunkt");

    const meta = document.createElement("p");
    meta.className = "meeting-agenda-meta";
    const metaParts = [];
    const caseNumber = String(point?.sag_number || "").trim();
    if (caseNumber) {
      metaParts.push(caseNumber);
    }
    const caseTitle = String(point?.sag_title || "").trim();
    if (caseTitle) {
      metaParts.push(caseTitle);
    }
    if (metaParts.length > 0) {
      meta.textContent = metaParts.join(" · ");
    } else {
      meta.textContent = "Ingen koblet sag registreret.";
    }

    copy.append(title, meta);

    const links = document.createElement("p");
    links.className = "meeting-agenda-links";

    if (caseNumber) {
      const localLink = document.createElement("a");
      localLink.className = "meeting-inline-link";
      localLink.href = `${window.Folkevalget.toSiteUrl("afstemninger.html")}?q=${encodeURIComponent(caseNumber)}`;
      localLink.textContent = "Se i afstemninger";
      links.append(localLink);

      const caseDate = String(point?.sagstrin_date || meeting?.date || "").trim();
      const officialCaseUrl = window.Folkevalget.buildSagUrl(caseNumber, caseDate);
      if (officialCaseUrl) {
        const separator = document.createElement("span");
        separator.className = "meeting-inline-separator";
        separator.textContent = "·";
        links.append(separator);

        const officialLink = document.createElement("a");
        officialLink.className = "meeting-inline-link";
        officialLink.href = officialCaseUrl;
        officialLink.target = "_blank";
        officialLink.rel = "noreferrer";
        officialLink.textContent = "Åbn sag på ft.dk";
        links.append(officialLink);
      }
    }

    if (links.childElementCount > 0) {
      copy.append(links);
    }

    item.append(number, copy);
    return item;
  }

  function filterMeetings(meetings, rawQuery) {
    const query = window.Folkevalget.normaliseText(rawQuery);
    if (!query) {
      return meetings;
    }

    const tokens = query.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return meetings;
    }

    return meetings.filter((meeting) => {
      const points = Array.isArray(meeting?.agenda_points) ? meeting.agenda_points : [];
      const pointSearchText = points
        .map((point) =>
          [
            point?.agenda_number,
            point?.agenda_title,
            point?.forhandling,
            point?.sag_number,
            point?.sag_title,
            point?.sagstrin_title,
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join(" ");

      const sourceText = [
        meeting?.title,
        meeting?.type,
        meeting?.status,
        meeting?.number,
        meeting?.date,
        pointSearchText,
      ]
        .filter(Boolean)
        .join(" ");

      const normalised = window.Folkevalget.normaliseText(sourceText);
      return tokens.every((token) => normalised.includes(token));
    });
  }

  function splitMeetings(meetings) {
    const todayIso = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Copenhagen" });
    const upcoming = [];
    const recent = [];

    for (const meeting of meetings) {
      const meetingDate = String(meeting?.date || "").trim();
      if (meetingDate && meetingDate >= todayIso) {
        upcoming.push(meeting);
      } else {
        recent.push(meeting);
      }
    }

    upcoming.sort(compareMeetingsUpcomingFirst);
    recent.sort(compareMeetingsRecentFirst);
    return { upcoming, recent };
  }

  function compareMeetingsUpcomingFirst(left, right) {
    const leftDate = String(left?.date || "");
    const rightDate = String(right?.date || "");
    if (leftDate !== rightDate) {
      return leftDate.localeCompare(rightDate);
    }
    return compareMeetingNumbers(left?.number, right?.number);
  }

  function compareMeetingsRecentFirst(left, right) {
    const leftDate = String(left?.date || "");
    const rightDate = String(right?.date || "");
    if (leftDate !== rightDate) {
      return rightDate.localeCompare(leftDate);
    }
    return compareMeetingNumbers(right?.number, left?.number);
  }

  function compareMeetingNumbers(leftNumber, rightNumber) {
    const leftValue = numericPrefix(leftNumber);
    const rightValue = numericPrefix(rightNumber);
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
    return String(leftNumber || "").localeCompare(String(rightNumber || ""), "da");
  }

  function numericPrefix(value) {
    const text = String(value || "").trim();
    if (!text) {
      return 0;
    }
    if (/^\d+$/.test(text)) {
      return Number(text);
    }
    const match = text.match(/^(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  function compareAgendaPoints(left, right) {
    const leftNumber = agendaNumberSortValue(left?.agenda_number);
    const rightNumber = agendaNumberSortValue(right?.agenda_number);

    if (leftNumber[0] !== rightNumber[0]) {
      return leftNumber[0] - rightNumber[0];
    }
    if (leftNumber[1] !== rightNumber[1]) {
      return leftNumber[1] - rightNumber[1];
    }
    if (leftNumber[2] !== rightNumber[2]) {
      return leftNumber[2].localeCompare(rightNumber[2], "da");
    }

    const leftDate = String(left?.sagstrin_date || "");
    const rightDate = String(right?.sagstrin_date || "");
    if (leftDate !== rightDate) {
      return leftDate.localeCompare(rightDate);
    }

    const leftId = Number(left?.agenda_point_id || 0);
    const rightId = Number(right?.agenda_point_id || 0);
    return leftId - rightId;
  }

  function agendaNumberSortValue(rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) {
      return [0, 0, ""];
    }
    if (/^\d+$/.test(value)) {
      return [0, Number(value), value];
    }
    const prefix = value.match(/^(\d+)/);
    if (prefix) {
      return [1, Number(prefix[1]), value.toLowerCase()];
    }
    return [2, 0, value.toLowerCase()];
  }

  function renderCountSummary(root, count, label) {
    if (!root) {
      return;
    }
    root.textContent = `${window.Folkevalget.formatNumber(count)} ${label}`;
  }

  function toggleMoreButton(button, rendered, total) {
    if (!button) {
      return;
    }
    button.classList.toggle("hidden", rendered >= total);
  }

  function formatMeetingMeta(meeting) {
    const parts = [];
    if (meeting?.date) {
      parts.push(window.Folkevalget.formatDate(meeting.date));
    }
    if (meeting?.number) {
      parts.push(`Møde ${meeting.number}`);
    }
    return parts.join(" · ") || "Dato ikke registreret";
  }

  function dedupeStrings(values) {
    const seen = new Set();
    const cleaned = [];
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
      cleaned.push(text);
    }
    return cleaned;
  }

  return { boot };
})();

MeetingsApp.boot().catch((error) => {
  console.error(error);
  const upcomingList = document.querySelector("#meeting-upcoming-list");
  const recentList = document.querySelector("#meeting-recent-list");
  if (upcomingList) {
    upcomingList.innerHTML = '<div class="panel-empty">Mødedata kunne ikke indlæses.</div>';
  }
  if (recentList) {
    recentList.innerHTML = '<div class="panel-empty">Mødedata kunne ikke indlæses.</div>';
  }
});
