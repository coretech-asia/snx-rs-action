const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const core = require("@actions/core");
const { installSnxRs } = require("./install-snx-rs");

const DEFAULT_CONNECT_TIMEOUT_SECONDS = 60;

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

  const { snxrsPath } = installation;
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
  isConnectedResult,
  logShowsConnected,
  parsePositiveInteger,
  renderConfig,
};
