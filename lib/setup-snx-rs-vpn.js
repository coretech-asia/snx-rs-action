const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const core = require("@actions/core");
const tc = require("@actions/tool-cache");

const REPO = "ancwrd1/snx-rs";
const TOOL_NAME = "snx-rs";
const SUPPORTED_PLATFORMS = ["linux"];
const SUPPORTED_ARCHITECTURES = ["x64", "arm64"];
const ARCHIVE_SUFFIXES = [".tar.xz", ".tar.gz", ".tgz", ".zip", ".run"];
const OS_NAME = {
  linux: ["linux", "unknown-linux", "linux-musl", "x86_64-unknown-linux", "i686-unknown-linux"],
};
const ARCH_NAME = {
  x64: ["x86_64", "amd64", "x64"],
  arm64: ["aarch64", "arm64"],
};
const GITHUB_HEADERS = {
  "User-Agent": "setup-snx-rs-vpn-action",
  Accept: "application/vnd.github+json",
};
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 60;

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    stdio: ["ignore", "inherit", "inherit"],
    shell: false,
  });

  if (result.error) {
    throw new Error(`Failed to run '${command}': ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`Command '${command}' exited with status ${result.status}.`);
  }
}

function quotePowerShellPath(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: GITHUB_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function normalizeVersionedTag(version) {
  if (version && version !== "latest") {
    return /^v/i.test(version) ? version : `v${version}`;
  }

  return "latest";
}

function assertSupportedRunner(platform, architecture) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new Error(`setup-snx-rs-vpn-action supports Linux runners only. Received platform=${platform}.`);
  }

  if (!SUPPORTED_ARCHITECTURES.includes(architecture)) {
    throw new Error(
      `setup-snx-rs-vpn-action supports Linux x64 and arm64 runners only. Received architecture=${architecture}.`,
    );
  }
}

function getBinaryName(platform, executable) {
  if (platform === "win32") {
    return `${executable}.exe`;
  }

  return executable;
}

function getAssetKind(name) {
  const lowerName = String(name || "").toLowerCase();

  for (const suffix of ARCHIVE_SUFFIXES) {
    if (lowerName.endsWith(suffix)) {
      return suffix;
    }
  }

  return null;
}

function getAssetPriority(name) {
  const lowerName = String(name || "").toLowerCase();
  const kind = getAssetKind(lowerName);

  if (!kind) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (kind === ".tar.xz") return 0;
  if (kind === ".tar.gz" || kind === ".tgz") return 1;
  if (kind === ".zip") return 2;
  if (kind === ".run") return 3;

  return Number.MAX_SAFE_INTEGER;
}

async function findBinary(root, preferredName) {
  const entries = await fsPromises.readdir(root, { withFileTypes: true });
  const lowerPreferred = preferredName.toLowerCase();

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      const candidate = await findBinary(fullPath, preferredName);
      if (candidate) {
        return candidate;
      }
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase() === lowerPreferred) {
      return fullPath;
    }
  }

  return null;
}

async function resolveRelease(version) {
  const requested = normalizeVersionedTag(version);
  const releaseUrl =
    requested === "latest"
      ? `https://api.github.com/repos/${REPO}/releases/latest`
      : `https://api.github.com/repos/${REPO}/releases/tags/${requested}`;

  return fetchJson(releaseUrl);
}

async function selectAsset(releaseData, platform, architecture) {
  const assets = Array.isArray(releaseData.assets) ? releaseData.assets : [];
  const osTokens = OS_NAME[platform] || [platform];
  const archTokens = ARCH_NAME[architecture] || [architecture];

  const matches = assets
    .filter((asset) => {
      const name = String(asset.name || "").toLowerCase();
      if (!name.includes("snx-rs")) {
        return false;
      }

      const hasPlatform = osTokens.some((token) => name.includes(token));
      if (!hasPlatform) {
        return false;
      }

      const hasArch = archTokens.some((token) => name.includes(token));
      if (!hasArch) {
        return false;
      }

      return getAssetKind(name) !== null;
    })
    .sort((a, b) => {
      const priorityDiff = getAssetPriority(a.name) - getAssetPriority(b.name);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return String(a.name || "").localeCompare(String(b.name || ""));
    });

  if (matches.length === 0) {
    const all = assets
      .map((asset) => String(asset.name || ""))
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Could not locate a matching snx-rs asset for platform=${platform}, arch=${architecture}. Available assets: ${all}`,
    );
  }

  return matches[0];
}

async function extractArchive(archivePath, destination) {
  await fsPromises.mkdir(destination, { recursive: true });
  const assetKind = getAssetKind(archivePath);

  if (assetKind === ".zip") {
    if (process.platform === "win32") {
      runCommand("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path ${quotePowerShellPath(archivePath)} -DestinationPath ${quotePowerShellPath(destination)} -Force`,
      ]);
    } else {
      runCommand("unzip", ["-q", archivePath, "-d", destination]);
    }
    return;
  }

  if (assetKind === ".tar.xz") {
    runCommand("tar", ["-xJf", archivePath, "-C", destination]);
    return;
  }

  if (assetKind === ".tar.gz" || assetKind === ".tgz") {
    runCommand("tar", ["-xzf", archivePath, "-C", destination]);
    return;
  }

  if (assetKind === ".run") {
    await fsPromises.chmod(archivePath, 0o755).catch(() => {});
    runCommand("sh", [archivePath, "--quiet", "--noexec", "--target", destination]);
    return;
  }

  throw new Error(`Unsupported archive type: ${archivePath}`);
}

async function installSnxRs(version) {
  const release = await resolveRelease(version);
  const tag = release.tag_name || normalizeVersionedTag(version);
  const cachedDirectory = tc.find(TOOL_NAME, tag, process.arch);

  if (cachedDirectory) {
    core.addPath(cachedDirectory);
    core.info(`Using cached snx-rs ${tag} from ${cachedDirectory}`);
    return { tag, directory: cachedDirectory };
  }

  const selectedAsset = await selectAsset(release, process.platform, process.arch);
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "snx-rs-install-"));
  const extractedDir = path.join(tempDir, "extracted");
  const archivePath = path.join(tempDir, String(selectedAsset.name));

  try {
    const toolPath = await tc.downloadTool(selectedAsset.browser_download_url, archivePath);
    await extractArchive(toolPath, extractedDir);

    const snxBinary = await findBinary(extractedDir, getBinaryName(process.platform, "snx-rs"));

    if (!snxBinary) {
      throw new Error("Could not find the snx-rs binary in the release archive.");
    }

    const cacheDir = path.dirname(snxBinary);
    const cachedDirectory = await tc.cacheDir(cacheDir, TOOL_NAME, tag, process.arch);

    core.addPath(cachedDirectory);
    core.info(`Installed snx-rs ${tag} on ${process.platform}/${process.arch}`);
    return { tag, directory: cachedDirectory };
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function resolveInstalledBinaries(rootDirectory) {
  const snxrsPath = await findBinary(rootDirectory, getBinaryName(process.platform, "snx-rs"));

  if (!snxrsPath) {
    throw new Error(`Could not resolve snx-rs under ${rootDirectory}.`);
  }

  return { snxrsPath };
}

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return fallbackValue;
}

function renderConfig(inputs) {
  const lines = [
    ["server-name", inputs.serverName],
    ["login-type", inputs.loginType],
    ["user-name", inputs.userName],
    ["password", Buffer.from(inputs.password, "utf8").toString("base64")],
    ["default-route", String(Boolean(inputs.defaultRoute))],
    ["ignore-server-cert", String(Boolean(inputs.ignoreServerCert))],
    ["log-level", inputs.logLevel || "info"],
    ["locale", "en-US"],
  ];

  if (inputs.tunnelType) {
    lines.push(["tunnel-type", inputs.tunnelType]);
  }

  if (inputs.caCert) {
    lines.push(["ca-cert", inputs.caCert]);
  }

  return `${lines.map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

async function createSessionFiles(configContent) {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "snx-rs-vpn-"));
  const configPath = path.join(tempDir, "snx-rs.conf");
  const logPath = path.join(tempDir, "snx-rs-command.log");

  await fsPromises.writeFile(configPath, configContent, { mode: 0o600 });
  await fsPromises.writeFile(logPath, "");

  return { tempDir, configPath, logPath };
}

function spawnDetached(command, args, logPath) {
  return new Promise((resolve, reject) => {
    const outputFd = fs.openSync(logPath, "a");
    const child = spawn(command, args, {
      detached: true,
      stdio: ["ignore", outputFd, outputFd],
    });

    const finish = (callback) => {
      try {
        fs.closeSync(outputFd);
      } catch {
        // Nothing to do.
      }
      callback();
    };

    child.once("error", (error) => {
      finish(() => reject(new Error(`Failed to start '${command}': ${error.message}`)));
    });

    child.once("spawn", () => {
      child.unref();
      finish(() => resolve(child.pid));
    });
  });
}

function summarizeOutput(stdout, stderr) {
  return [stdout, stderr].filter(Boolean).join("\n").trim();
}

function isConnectedResult(result) {
  if (result.exitCode !== 0) {
    return false;
  }

  const output = summarizeOutput(result.stdout, result.stderr);
  return output.includes("Connected since:");
}

function logShowsConnected(logContent) {
  return logContent.includes("Connected since:") || logContent.includes("Tunnel connected, press Ctrl-C to exit.");
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runProcess(command, args, options = {}) {
  const {
    timeoutMs,
    allowNonZero = false,
    env,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutId;

    const finish = (callback) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      settled = true;
      callback();
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      if (settled) {
        return;
      }

      finish(() => reject(new Error(`Failed to start '${command}': ${error.message}`)));
    });

    child.once("close", (exitCode, signal) => {
      if (settled) {
        return;
      }

      finish(() => {
        const result = {
          exitCode: exitCode ?? 1,
          signal,
          stdout,
          stderr,
        };

        if (!allowNonZero && result.exitCode !== 0) {
          const output = summarizeOutput(stdout, stderr);
          reject(
            new Error(
              `Command '${command} ${args.join(" ")}' exited with status ${result.exitCode}${output ? `: ${output}` : "."}`,
            ),
          );
          return;
        }

        resolve(result);
      });
    });

    if (timeoutMs) {
      timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`Command '${command} ${args.join(" ")}' timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    }
  });
}

async function waitFor(predicate, timeoutMs, errorMessage) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;

  while (Date.now() < deadline) {
    lastValue = await predicate();
    if (lastValue.ok) {
      return lastValue.value;
    }
    await sleep(500);
  }

  const details = lastValue && lastValue.detail ? ` ${lastValue.detail}` : "";
  throw new Error(`${errorMessage}${details}`);
}

async function waitForTunnelConnected(logPath, daemonPid, timeoutMs) {
  return waitFor(
    async () => {
      const logContent = await fsPromises.readFile(logPath, "utf8").catch(() => "");

      if (logShowsConnected(logContent)) {
        return { ok: true, value: logContent };
      }

      const processStatus = await runProcess("kill", ["-0", String(daemonPid)], {
        allowNonZero: true,
      });
      if (processStatus.exitCode !== 0) {
        return {
          ok: false,
          detail: logContent || "snx-rs exited before reporting a connected tunnel.",
        };
      }

      return {
        ok: false,
        detail: logContent,
      };
    },
    timeoutMs,
    "Timed out waiting for snx-rs to report a connected tunnel in standalone mode.",
  );
}

async function terminateDaemonProcess(pid) {
  if (!pid) {
    return;
  }

  const attempts = [
    ["kill", "-TERM", String(pid)],
    ["kill", "-KILL", String(pid)],
  ];

  for (const args of attempts) {
    const result = await runProcess("sudo", args, { allowNonZero: true });
    if (result.exitCode === 0) {
      await sleep(250);
      return;
    }
  }
}

function readBooleanState(name) {
  return core.getState(name) === "true";
}

async function run() {
  assertSupportedRunner(process.platform, process.arch);

  const version = core.getInput("version", { required: false }) || "latest";
  const inputs = {
    serverName: core.getInput("server-name", { required: true }),
    loginType: core.getInput("login-type", { required: true }),
    userName: core.getInput("user-name", { required: true }),
    password: core.getInput("password", { required: true }),
    defaultRoute: core.getBooleanInput("default-route", { required: false }),
    ignoreServerCert: core.getBooleanInput("ignore-server-cert", { required: false }),
    tunnelType: core.getInput("tunnel-type", { required: false }),
    logLevel: core.getInput("log-level", { required: false }) || "info",
    caCert: core.getInput("ca-cert", { required: false }),
  };
  const connectTimeoutSeconds = parsePositiveInteger(
    core.getInput("connect-timeout-seconds", { required: false }),
    DEFAULT_CONNECT_TIMEOUT_SECONDS,
  );
  const connectTimeoutMs = connectTimeoutSeconds * 1000;

  core.setSecret(inputs.password);
  core.setSecret(Buffer.from(inputs.password, "utf8").toString("base64"));

  const installation = await installSnxRs(version);
  const installedVersion = installation.tag;
  core.setOutput("installed-version", installedVersion);

  const { snxrsPath } = await resolveInstalledBinaries(installation.directory);
  process.env.PATH = `${installation.directory}${path.delimiter}${process.env.PATH || ""}`;
  core.saveState("snxrsPath", snxrsPath);

  const configContent = renderConfig(inputs);
  const { tempDir, configPath, logPath } = await createSessionFiles(configContent);
  core.saveState("tempDir", tempDir);
  core.saveState("configPath", configPath);
  core.saveState("logPath", logPath);
  core.saveState("connected", "false");

  const daemonPid = await spawnDetached("sudo", [snxrsPath, "-m", "standalone", "-c", configPath], logPath);
  core.saveState("daemonPid", String(daemonPid));
  core.info(`Started snx-rs standalone process with pid ${daemonPid}`);

  try {
    await waitForTunnelConnected(logPath, daemonPid, connectTimeoutMs);
    core.setOutput("connected", "true");
    core.saveState("connected", "true");
    core.info(`Connected snx-rs tunnel for ${inputs.serverName}`);
  } catch (error) {
    const daemonLog = await fsPromises.readFile(logPath, "utf8").catch(() => "");
    if (daemonLog) {
      core.info("snx-rs daemon log follows:");
      core.info(daemonLog.trim());
    }
    throw error;
  }
}

async function cleanup() {
  const configPath = core.getState("configPath");
  const tempDir = core.getState("tempDir");
  const logPath = core.getState("logPath");
  const daemonPid = core.getState("daemonPid");
  const connected = readBooleanState("connected");
  const daemonLog = logPath ? await fsPromises.readFile(logPath, "utf8").catch(() => "") : "";

  if (daemonPid && connected) {
    await terminateDaemonProcess(Number.parseInt(daemonPid, 10)).catch((error) => {
      core.warning(`Failed to stop snx-rs standalone process: ${error.message}`);
    });
  }

  if (tempDir) {
    await fsPromises.rm(tempDir, { recursive: true, force: true }).catch((error) => {
      core.warning(`Failed to remove temporary session files: ${error.message}`);
    });
  }

  if (daemonLog) {
    core.info("snx-rs daemon log from cleanup follows:");
    core.info(daemonLog.trim());
  }
}

exports.run = run;
exports.cleanup = cleanup;
exports.__test = {
  DEFAULT_CONNECT_TIMEOUT_SECONDS,
  assertSupportedRunner,
  getAssetKind,
  getAssetPriority,
  isConnectedResult,
  logShowsConnected,
  normalizeVersionedTag,
  parsePositiveInteger,
  renderConfig,
  resolveInstalledBinaries,
  selectAsset,
};
