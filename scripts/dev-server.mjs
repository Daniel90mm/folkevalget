import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { spawn } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const host = args.host || "127.0.0.1";
const port = Number(args.port || 4173);
const quiet = Boolean(args.quiet);
const shouldOpen = Boolean(args.open);
const rootDir = resolve(process.cwd());

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
]);

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
    const pathname = decodeURIComponent(requestUrl.pathname);
    const filePath = await resolveRequestPath(pathname);
    const fileInfo = await stat(filePath);

    response.writeHead(200, {
      "Content-Type": MIME_TYPES.get(extname(filePath).toLowerCase()) || "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Length": fileInfo.size,
    });

    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(error?.code === "ENOENT" ? "Not Found" : "Server Error");
  }
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}`;
  if (!quiet) {
    console.log(`Folkevalget dev server running at ${url}`);
  }
  if (shouldOpen) {
    openBrowser(url);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

async function resolveRequestPath(pathname) {
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let candidate = resolve(rootDir, `.${safePath}`);

  if (!candidate.startsWith(rootDir)) {
    throw Object.assign(new Error("Path traversal rejected"), { code: "EACCES" });
  }

  try {
    const fileInfo = await stat(candidate);
    if (fileInfo.isDirectory()) {
      candidate = join(candidate, "index.html");
    }
  } catch (error) {
    if (pathname === "/") {
      candidate = resolve(rootDir, "index.html");
    } else if (!extname(candidate)) {
      candidate = resolve(rootDir, `.${safePath}.html`);
    } else {
      throw error;
    }
  }

  return candidate;
}

function openBrowser(url) {
  const platform = process.platform;
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}
