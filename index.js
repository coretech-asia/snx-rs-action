const core = require("@actions/core");
const { cleanup, run } = require("./lib/setup-snx-rs-vpn");

(async () => {
  const isPost = !!core.getState("isPost");

  try {
    if (!isPost) {
      await run();
    } else {
      await cleanup();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
  }

  if (!isPost) {
    core.saveState("isPost", "true");
  }
})();
