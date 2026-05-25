import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const normalizedProjectRoot = normalize(projectRoot);
const currentPid = process.pid;

function normalize(value) {
  return value.replaceAll("/", "\\").toLowerCase();
}

function isProjectNextDevProcess(processInfo) {
  const commandLine = processInfo.commandLine ?? "";
  const normalizedCommandLine = normalize(commandLine);

  return (
    processInfo.pid !== currentPid &&
    normalizedCommandLine.includes(normalizedProjectRoot) &&
    normalizedCommandLine.includes("next") &&
    /\bdev\b/i.test(commandLine) &&
    !normalizedCommandLine.includes("clean-e2e-servers")
  );
}

function windowsNodeProcesses() {
  const script = [
    "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\"",
    "Select-Object ProcessId,CommandLine",
    "ConvertTo-Json -Compress",
  ].join(" | ");
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    { encoding: "utf8" },
  ).trim();

  if (!output) {
    return [];
  }

  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((processInfo) => ({
    pid: Number(processInfo.ProcessId),
    commandLine: String(processInfo.CommandLine ?? ""),
  }));
}

function unixProcesses() {
  const output = execFileSync("ps", ["-eo", "pid=,command="], {
    encoding: "utf8",
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      return match
        ? { pid: Number(match[1]), commandLine: match[2] }
        : { pid: Number.NaN, commandLine: line };
    })
    .filter((processInfo) => Number.isFinite(processInfo.pid));
}

function listProcesses() {
  return process.platform === "win32" ? windowsNodeProcesses() : unixProcesses();
}

function stopProcess(pid) {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (output) {
      process.stdout.write(output);
    }
    if (result.status !== 0 && /not found/i.test(output)) {
      return { status: 0 };
    }
    return result;
  }

  try {
    process.kill(pid, "SIGTERM");
    return { status: 0 };
  } catch (error) {
    console.warn(`Could not stop stale process ${pid}: ${error.message}`);
    return { status: 1 };
  }
}

const staleServers = listProcesses().filter(isProjectNextDevProcess);

for (const server of staleServers) {
  console.log(`Stopping stale Next dev server ${server.pid}`);
  const result = stopProcess(server.pid);
  if (result.status !== 0) {
    process.exitCode = 1;
  }
}
