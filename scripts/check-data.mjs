import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const errors = [];

const profiles = await loadJson("data/profiler.json");
const votes = await loadJson("data/afstemninger_overblik.json");
const committees = await loadJson("data/udvalg.json");
const meetingsPayload = await loadJson("data/moeder.json");
const parties = await loadJson("data/partier.json");

validateProfiles(profiles);
validateVotes(votes);
validateCommittees(committees);
validateMeetings(meetingsPayload);
validateParties(parties);

if (errors.length > 0) {
  console.error("Data validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const currentProfiles = profiles.filter((profile) => Boolean(profile?.current_party) && Boolean(profile?.storkreds));
console.log(
  [
    "Data validation OK.",
    `${currentProfiles.length} current members`,
    `${votes.length} votes`,
    `${committees.length} committees`,
    `${meetingsPayload.meetings.length} meetings`,
    `${parties.length} party rows`,
  ].join(" ")
);

async function loadJson(relativePath) {
  const absolutePath = join(ROOT, relativePath);
  const text = await readFile(absolutePath, "utf-8");
  return JSON.parse(text);
}

function validateProfiles(value) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("data/profiler.json must be a non-empty array.");
    return;
  }

  const currentProfiles = value.filter((profile) => Boolean(profile?.current_party) && Boolean(profile?.storkreds));
  if (currentProfiles.length !== 179) {
    errors.push(`Expected 179 current members, found ${currentProfiles.length}.`);
  }

  const currentIds = new Set();
  for (const profile of currentProfiles) {
    requireObjectKeys(profile, ["id", "name", "current_party", "current_party_short", "storkreds"], "Current profile");
    if (!Array.isArray(profile?.committees)) {
      errors.push(`Current profile ${profile?.id || "unknown"} is missing committees array.`);
    }
    const id = Number(profile?.id || 0);
    if (!Number.isInteger(id) || id <= 0) {
      errors.push(`Current profile has invalid id: ${profile?.id}`);
      continue;
    }
    if (currentIds.has(id)) {
      errors.push(`Duplicate current profile id detected: ${id}.`);
    }
    currentIds.add(id);
  }
}

function validateVotes(value) {
  if (!Array.isArray(value) || value.length < 1000) {
    errors.push(`data/afstemninger_overblik.json looks too small: ${Array.isArray(value) ? value.length : "not-an-array"}.`);
    return;
  }

  for (const vote of value) {
    requireObjectKeys(
      vote,
      ["afstemning_id", "date", "sag_id", "sag_number", "sag_short_title", "counts", "margin", "vedtaget"],
      "Vote overview item"
    );
    if (!isIsoDate(vote?.date)) {
      errors.push(`Vote ${vote?.afstemning_id || "unknown"} has invalid date: ${vote?.date}`);
    }
    if (!vote?.counts || typeof vote.counts !== "object") {
      errors.push(`Vote ${vote?.afstemning_id || "unknown"} is missing counts object.`);
      continue;
    }
    for (const key of ["for", "imod", "fravaer", "hverken"]) {
      const count = Number(vote.counts[key]);
      if (!Number.isFinite(count) || count < 0) {
        errors.push(`Vote ${vote?.afstemning_id || "unknown"} has invalid counts.${key}: ${vote.counts[key]}`);
      }
    }
  }
}

function validateCommittees(value) {
  if (!Array.isArray(value) || value.length < 30) {
    errors.push(`data/udvalg.json looks too small: ${Array.isArray(value) ? value.length : "not-an-array"}.`);
    return;
  }

  for (const committee of value) {
    requireObjectKeys(committee, ["id", "name", "short_name", "member_ids"], "Committee item");
    if (!Array.isArray(committee?.member_ids)) {
      errors.push(`Committee ${committee?.short_name || committee?.name || "unknown"} is missing member_ids array.`);
    }
  }
}

function validateMeetings(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.meetings) || value.meetings.length < 50) {
    errors.push("data/moeder.json must contain a meetings array with at least 50 rows.");
    return;
  }

  for (const meeting of value.meetings) {
    requireObjectKeys(meeting, ["meeting_id", "date", "title", "type", "status", "agenda_points"], "Meeting item");
    if (!isIsoDate(meeting?.date)) {
      errors.push(`Meeting ${meeting?.meeting_id || "unknown"} has invalid date: ${meeting?.date}`);
    }
    if (!Array.isArray(meeting?.agenda_points)) {
      errors.push(`Meeting ${meeting?.meeting_id || "unknown"} is missing agenda_points array.`);
    }
  }
}

function validateParties(value) {
  if (!Array.isArray(value) || value.length < 10) {
    errors.push(`data/partier.json looks too small: ${Array.isArray(value) ? value.length : "not-an-array"}.`);
    return;
  }

  for (const party of value) {
    requireObjectKeys(party, ["id", "name", "short_name", "member_count", "member_ids"], "Party item");
    if (!Array.isArray(party?.member_ids)) {
      errors.push(`Party ${party?.short_name || party?.name || "unknown"} is missing member_ids array.`);
    }
  }
}

function requireObjectKeys(value, keys, label) {
  if (!value || typeof value !== "object") {
    errors.push(`${label} is not an object.`);
    return;
  }
  for (const key of keys) {
    if (!(key in value)) {
      errors.push(`${label} is missing key "${key}".`);
    }
  }
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
