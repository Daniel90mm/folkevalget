import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const IGNORED_DIRS = new Set([
  ".git",
  ".claude",
  "data",
  "node_modules",
  "photos",
  "reports",
  "__pycache__",
  ".tmpdata",
  ".tmpdata2",
  ".tmpdata_timeline",
]);

const files = await collectJavaScriptFiles(ROOT);
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: ROOT,
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    failures.push({
      file: relative(ROOT, file),
      stderr: (result.stderr || result.stdout || "").trim(),
    });
  }
}

if (failures.length > 0) {
  console.error(`JavaScript syntax check failed for ${failures.length} file(s):`);
  for (const failure of failures) {
    console.error(`- ${failure.file}`);
    if (failure.stderr) {
      console.error(failure.stderr);
    }
  }
  process.exit(1);
}

console.log(`JavaScript syntax OK (${files.length} files checked).`);

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const collected = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      collected.push(...(await collectJavaScriptFiles(absolutePath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      collected.push(absolutePath);
    }
  }

  return collected.sort((left, right) => left.localeCompare(right));
}
