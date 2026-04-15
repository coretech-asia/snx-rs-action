const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
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
  "User-Agent": "snx-rs-action",
  Accept: "application/vnd.github+json",
};

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
    throw new Error(`snx-rs-action supports Linux runners only. Received platform=${platform}.`);
  }

  if (!SUPPORTED_ARCHITECTURES.includes(architecture)) {
    throw new Error(
      `snx-rs-action supports Linux x64 and arm64 runners only. Received architecture=${architecture}.`,
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

  let priority = Number.MAX_SAFE_INTEGER;

  if (kind === ".tar.xz") priority = 0;
  else if (kind === ".tar.gz" || kind === ".tgz") priority = 1;
  else if (kind === ".zip") priority = 2;
  else if (kind === ".run") priority = 3;

  if (lowerName.includes("webkit")) {
    priority += 10;
  }

  return priority;
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

      return String(a.name || "").toLowerCase().localeCompare(String(b.name || "").toLowerCase());
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

async function resolveInstalledBinaries(rootDirectory, executable = "snx-rs") {
  const snxrsPath = await findBinary(rootDirectory, getBinaryName(process.platform, executable));

  if (!snxrsPath) {
    throw new Error(`Could not resolve ${executable} under ${rootDirectory}.`);
  }

  return { snxrsPath };
}

async function installSnxRs(version, options = {}) {
  const executable = options.executable || "snx-rs";
  assertSupportedRunner(process.platform, process.arch);

  const release = await resolveRelease(version);
  const tag = release.tag_name || normalizeVersionedTag(version);
  const cachedDirectory = tc.find(TOOL_NAME, tag, process.arch);

  if (cachedDirectory) {
    core.addPath(cachedDirectory);
    core.info(`Using cached ${executable} ${tag} from ${cachedDirectory}`);
    const binaries = await resolveInstalledBinaries(cachedDirectory, executable);
    return { tag, directory: cachedDirectory, ...binaries };
  }

  const selectedAsset = await selectAsset(release, process.platform, process.arch);
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "snx-rs-install-"));
  const extractedDir = path.join(tempDir, "extracted");
  const archivePath = path.join(tempDir, String(selectedAsset.name));

  try {
    const toolPath = await tc.downloadTool(selectedAsset.browser_download_url, archivePath);
    await extractArchive(toolPath, extractedDir);

    const locatedBinary = await findBinary(extractedDir, getBinaryName(process.platform, executable));

    if (!locatedBinary) {
      throw new Error(`Could not find the ${executable} binary in the release archive.`);
    }

    const sourceDirectory = path.dirname(locatedBinary);
    const installedDirectory = await tc.cacheDir(sourceDirectory, TOOL_NAME, tag, process.arch);
    core.addPath(installedDirectory);

    const binaries = await resolveInstalledBinaries(installedDirectory, executable);
    core.info(`Installed ${executable} ${tag} on ${process.platform}/${process.arch}`);
    return { tag, directory: installedDirectory, ...binaries };
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

exports.installSnxRs = installSnxRs;
exports.resolveInstalledBinaries = resolveInstalledBinaries;
exports.__test = {
  assertSupportedRunner,
  getAssetKind,
  getAssetPriority,
  getBinaryName,
  normalizeVersionedTag,
  selectAsset,
};
