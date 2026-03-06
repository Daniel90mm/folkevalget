const DEFAULT_RANGE = "365";
const AGENDA_PREVIEW_LIMIT = 12;

const MeetingsApp = (() => {
  const state = {
    meetings: [],
    scopeNote: "",
    generatedAt: null,
    query: "",
    range: DEFAULT_RANGE,
    status: "all",
    selectedMeetingId: null,
  };

  const statsRoot = document.querySelector("[data-site-stats]");
  const searchInput = document.querySelector("#meeting-search");
  const rangeSelect = document.querySelector("#meeting-range");
  const statusSelect = document.querySelector("#meeting-status");
  const scopeNote = document.querySelector("#meeting-scope-note");
  const summaryNote = document.querySelector("#meeting-summary-note");
  const updatedNote = document.querySelector("#meeting-updated-note");
  const timelineRoot = document.querySelector("#meeting-timeline");
  const detailRoot = document.querySelector("#meeting-detail");

  async function boot() {
    const [{ stats }, meetingsPayload] = await Promise.all([
      window.Folkevalget.loadCatalogueData(),
      loadMeetingsPayload(),
    ]);

    window.Folkevalget.renderStats(statsRoot, stats);
    state.meetings = Array.isArray(meetingsPayload?.meetings) ? meetingsPayload.meetings.slice().sort(compareMeetingsAscending) : [];
    state.scopeNote = String(meetingsPayload?.scope_note || "").trim();
    state.generatedAt = meetingsPayload?.generated_at || null;
    hydrateStateFromQuery();
    syncControls();
    bindEvents();
    render(true);
  }

  function hydrateStateFromQuery() {
    const params = new URLSearchParams(window.location.search);
    state.query = params.get("q") || "";
    state.range = params.get("range") || DEFAULT_RANGE;
    state.status = params.get("status") || "all";
    const selectedMeetingId = Number(params.get("meeting") || 0);
    state.selectedMeetingId = Number.isFinite(selectedMeetingId) && selectedMeetingId > 0 ? selectedMeetingId : null;
  }

  function syncControls() {
    if (searchInput) {
      searchInput.value = state.query;
    }
    if (rangeSelect) {
      rangeSelect.value = state.range;
    }
    if (statusSelect) {
      statusSelect.value = state.status;
    }
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
      .sort(compareMeetingsAscending);

    return {
      generated_at: nowIso,
      scope_note: "Møder bygget lokalt fra sagsforløb, fordi data/moeder.json ikke var tilgængelig.",
      meetings,
    };
  }

  function bindEvents() {
    searchInput?.addEventListener("input", () => {
      state.query = searchInput.value || "";
      state.selectedMeetingId = null;
      render(true);
    });

    rangeSelect?.addEventListener("change", () => {
      state.range = String(rangeSelect.value || DEFAULT_RANGE);
      state.selectedMeetingId = null;
      render(true);
    });

    statusSelect?.addEventListener("change", () => {
      state.status = String(statusSelect.value || "all");
      state.selectedMeetingId = null;
      render(true);
    });

    timelineRoot?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-meeting-id]");
      if (!button) {
        return;
      }
      const meetingId = Number(button.getAttribute("data-meeting-id") || 0);
      if (!Number.isFinite(meetingId) || meetingId <= 0) {
        return;
      }
      state.selectedMeetingId = meetingId;
      render(false);
    });
  }

  function render(shouldCenterSelection) {
    const filtered = filterMeetings(state.meetings, {
      query: state.query,
      range: state.range,
      status: state.status,
    });
    const selectedMeeting = ensureSelectedMeeting(filtered);
    renderScope(filtered);
    renderTimeline(filtered, selectedMeeting, shouldCenterSelection);
    renderDetail(selectedMeeting);
    syncQueryString(selectedMeeting);
  }

  function syncQueryString(selectedMeeting) {
    const params = new URLSearchParams();
    if (state.query) {
      params.set("q", state.query);
    }
    if (state.range !== DEFAULT_RANGE) {
      params.set("range", state.range);
    }
    if (state.status !== "all") {
      params.set("status", state.status);
    }

    const meetingId = Number(selectedMeeting?.meeting_id || 0);
    if (meetingId > 0) {
      params.set("meeting", String(meetingId));
    }

    const next = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
    window.history.replaceState({}, "", next);
  }

  function renderScope(filteredMeetings) {
    if (scopeNote) {
      scopeNote.textContent =
        state.scopeNote || "Viser møder og dagsordenspunkter fra Folketingets ODA-data i det aktuelle datasæt.";
    }

    if (updatedNote) {
      updatedNote.textContent = `Opdateret: ${window.Folkevalget.formatDate(state.generatedAt)}`;
    }

    if (!summaryNote) {
      return;
    }
    const meetingCount = filteredMeetings.length;
    let agendaCount = 0;
    let upcomingCount = 0;
    for (const meeting of filteredMeetings) {
      agendaCount += Number(meeting?.agenda_point_count || meeting?.agenda_points?.length || 0);
      if (isUpcomingMeeting(meeting)) {
        upcomingCount += 1;
      }
    }
    const heldCount = Math.max(0, meetingCount - upcomingCount);
    summaryNote.textContent =
      `${window.Folkevalget.formatNumber(meetingCount)} møder · ` +
      `${window.Folkevalget.formatNumber(agendaCount)} dagsordenspunkter · ` +
      `${window.Folkevalget.formatNumber(upcomingCount)} kommende · ` +
      `${window.Folkevalget.formatNumber(heldCount)} afholdte`;
  }

  function renderTimeline(meetings, selectedMeeting, shouldCenterSelection) {
    if (!timelineRoot) {
      return;
    }
    timelineRoot.innerHTML = "";

    if (meetings.length === 0) {
      timelineRoot.innerHTML = '<div class="panel-empty">Ingen møder matcher den aktuelle søgning.</div>';
      return;
    }

    const selectedId = Number(selectedMeeting?.meeting_id || 0);
    const fragment = document.createDocumentFragment();
    for (const meeting of meetings) {
      const node = buildTimelineMeeting(meeting, selectedId);
      fragment.append(node);
    }
    timelineRoot.append(fragment);

    if (shouldCenterSelection && selectedId > 0) {
      const selectedNode = timelineRoot.querySelector(`.meeting-timeline-item[data-meeting-id="${selectedId}"]`);
      selectedNode?.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }

  function buildTimelineMeeting(meeting, selectedMeetingId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "meeting-timeline-item";

    const meetingId = Number(meeting?.meeting_id || 0);
    if (meetingId > 0) {
      button.setAttribute("data-meeting-id", String(meetingId));
    }

    if (meetingId === selectedMeetingId) {
      button.classList.add("is-selected");
      button.setAttribute("aria-current", "true");
    }

    const date = document.createElement("p");
    date.className = "meeting-timeline-date";
    date.textContent = window.Folkevalget.formatDate(meeting?.date);

    const title = document.createElement("p");
    title.className = "meeting-timeline-title";
    title.textContent = String(meeting?.number || "").trim() ? `Møde ${meeting.number}` : "Møde";

    const meta = document.createElement("p");
    meta.className = "meeting-timeline-meta";
    const agendaCount = Number(meeting?.agenda_point_count || meeting?.agenda_points?.length || 0);
    const metaParts = [];
    if (meeting?.status) {
      metaParts.push(String(meeting.status));
    }
    metaParts.push(`${window.Folkevalget.formatNumber(agendaCount)} punkter`);
    meta.textContent = metaParts.join(" · ");

    button.append(date, title, meta);
    return button;
  }

  function renderDetail(meeting) {
    if (!detailRoot) {
      return;
    }
    detailRoot.innerHTML = "";

    if (!meeting) {
      detailRoot.innerHTML = '<div class="panel-empty">Vælg et møde for at se dagsordenspunkter.</div>';
      return;
    }

    const detail = document.createElement("article");
    detail.className = "meeting-detail";

    const head = document.createElement("header");
    head.className = "meeting-detail-head";

    const headCopy = document.createElement("div");
    headCopy.className = "meeting-detail-copy";

    const meta = document.createElement("p");
    meta.className = "meeting-item-meta";
    meta.textContent = formatMeetingMeta(meeting);

    const title = document.createElement("h3");
    title.className = "meeting-item-title";
    title.textContent = String(meeting?.title || "Møde i Folketinget");

    const detailParts = dedupeStrings([meeting?.type, meeting?.status, meeting?.start_note]);
    const detailText = document.createElement("p");
    detailText.className = "meeting-item-detail";
    detailText.textContent =
      detailParts.length > 0 ? detailParts.join(" · ") : "Ingen supplerende mødeinformation registreret.";

    headCopy.append(meta, title, detailText);
    head.append(headCopy);

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

    const agendaSection = document.createElement("section");
    agendaSection.className = "meeting-agenda";

    const agendaHead = document.createElement("div");
    agendaHead.className = "meeting-agenda-head";

    const agendaTitle = document.createElement("h4");
    agendaTitle.textContent = "Dagsordenspunkter";
    agendaHead.append(agendaTitle);

    const points = Array.isArray(meeting?.agenda_points) ? meeting.agenda_points : [];
    const agendaCount = Number(meeting?.agenda_point_count || points.length || 0);
    const agendaCountNote = document.createElement("p");
    agendaCountNote.className = "table-note";
    agendaCountNote.textContent = `${window.Folkevalget.formatNumber(agendaCount)} punkter`;
    agendaHead.append(agendaCountNote);

    agendaSection.append(agendaHead);

    if (points.length === 0) {
      const empty = document.createElement("p");
      empty.className = "meeting-agenda-empty";
      empty.textContent = "Ingen registrerede dagsordenspunkter i dette datasæt.";
      agendaSection.append(empty);
    } else {
      const list = document.createElement("ul");
      list.className = "meeting-agenda-list";

      const visiblePoints = points.slice(0, AGENDA_PREVIEW_LIMIT);
      for (const point of visiblePoints) {
        list.append(buildAgendaRow(point, meeting));
      }
      agendaSection.append(list);

      if (points.length > visiblePoints.length) {
        const more = document.createElement("p");
        more.className = "meeting-agenda-more";
        more.textContent = `+${window.Folkevalget.formatNumber(points.length - visiblePoints.length)} yderligere dagsordenspunkter i mødet.`;
        agendaSection.append(more);
      }
    }

    detail.append(head, agendaSection);
    detailRoot.append(detail);
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
    title.textContent = String(point?.agenda_title || point?.sagstrin_title || "Dagsordenspunkt");

    const meta = document.createElement("p");
    meta.className = "meeting-agenda-meta";
    const metaParts = [];
    const caseNumber = String(point?.sag_number || "").trim();
    const caseTitle = String(point?.sag_title || "").trim();
    if (caseNumber) {
      metaParts.push(caseNumber);
    }
    if (caseTitle) {
      metaParts.push(caseTitle);
    }
    meta.textContent = metaParts.length > 0 ? metaParts.join(" · ") : "Ingen koblet sag registreret.";
    copy.append(title, meta);

    const links = buildAgendaLinks(point, meeting);
    if (links) {
      copy.append(links);
    }

    item.append(number, copy);
    return item;
  }

  function buildAgendaLinks(point, meeting) {
    const caseNumber = String(point?.sag_number || "").trim();
    if (!caseNumber) {
      return null;
    }

    const links = document.createElement("p");
    links.className = "meeting-agenda-links";

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

    return links;
  }

  function filterMeetings(meetings, filters) {
    const query = window.Folkevalget.normaliseText(filters?.query || "");
    const tokens = query ? query.split(/\s+/).filter(Boolean) : [];
    const cutoffIso = resolveCutoffIso(filters?.range);
    const status = String(filters?.status || "all");

    return meetings.filter((meeting) => {
      const meetingDate = String(meeting?.date || "").trim();

      if (status === "upcoming" && !isUpcomingMeeting(meeting)) {
        return false;
      }
      if (status === "held" && isUpcomingMeeting(meeting)) {
        return false;
      }

      if (cutoffIso && meetingDate && meetingDate < cutoffIso) {
        return false;
      }

      if (tokens.length === 0) {
        return true;
      }

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
            point?.sagstrin_type,
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

  function ensureSelectedMeeting(filteredMeetings) {
    if (filteredMeetings.length === 0) {
      state.selectedMeetingId = null;
      return null;
    }

    if (state.selectedMeetingId) {
      const existing = filteredMeetings.find(
        (meeting) => Number(meeting?.meeting_id || 0) === Number(state.selectedMeetingId)
      );
      if (existing) {
        return existing;
      }
    }

    const fallback = filteredMeetings[filteredMeetings.length - 1];
    state.selectedMeetingId = Number(fallback?.meeting_id || 0) || null;
    return fallback;
  }

  function resolveCutoffIso(rangeValue) {
    const value = String(rangeValue || DEFAULT_RANGE).trim().toLowerCase();
    if (!value || value === "all") {
      return null;
    }

    const days = Number(value);
    if (!Number.isFinite(days) || days <= 0) {
      return null;
    }

    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - days);
    return cutoff.toLocaleDateString("sv-SE", { timeZone: "Europe/Copenhagen" });
  }

  function isUpcomingMeeting(meeting) {
    const meetingDate = String(meeting?.date || "").trim();
    if (!meetingDate) {
      return false;
    }
    return meetingDate >= getTodayIso();
  }

  function getTodayIso() {
    return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Copenhagen" });
  }

  function compareMeetingsAscending(left, right) {
    const leftDate = String(left?.date || "");
    const rightDate = String(right?.date || "");
    if (leftDate !== rightDate) {
      return leftDate.localeCompare(rightDate);
    }
    return compareMeetingNumbers(left?.number, right?.number);
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
  const timelineRoot = document.querySelector("#meeting-timeline");
  const detailRoot = document.querySelector("#meeting-detail");
  if (timelineRoot) {
    timelineRoot.innerHTML = '<div class="panel-empty">Mødedata kunne ikke indlæses.</div>';
  }
  if (detailRoot) {
    detailRoot.innerHTML = '<div class="panel-empty">Mødedata kunne ikke indlæses.</div>';
  }
});
