const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const core = require("@actions/core");
const { installSnxRs } = require("../lib/install-snx-rs");

(async () => {
  try {
    if (!process.env.RUNNER_TOOL_CACHE) {
      process.env.RUNNER_TOOL_CACHE = path.join(os.tmpdir(), "snx-rs-tool-cache");
    }
    if (!process.env.RUNNER_TEMP) {
      process.env.RUNNER_TEMP = path.join(os.tmpdir(), "snx-rs-runner-temp");
    }

    await fsPromises.mkdir(process.env.RUNNER_TOOL_CACHE, { recursive: true });
    await fsPromises.mkdir(process.env.RUNNER_TEMP, { recursive: true });

    const installation = await installSnxRs("latest");
    core.info(`Smoke-installed snx-rs ${installation.tag} at ${installation.snxrsPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
    process.exitCode = 1;
  }
})();
