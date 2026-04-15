const test = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../lib/setup-snx-rs-vpn");

test("normalizeVersionedTag preserves latest and adds leading v when needed", () => {
  assert.equal(__test.normalizeVersionedTag("latest"), "latest");
  assert.equal(__test.normalizeVersionedTag("5.3.0"), "v5.3.0");
  assert.equal(__test.normalizeVersionedTag("v5.3.0"), "v5.3.0");
});

test("selectAsset prefers tar.xz archives over .run installers", async () => {
  const asset = await __test.selectAsset(
    {
      assets: [
        { name: "snx-rs-v5.3.0-linux-x86_64.run" },
        { name: "snx-rs-v5.3.0-linux-x86_64.tar.gz" },
        { name: "snx-rs-v5.3.0-linux-x86_64.tar.xz" },
      ],
    },
    "linux",
    "x64",
  );

  assert.equal(asset.name, "snx-rs-v5.3.0-linux-x86_64.tar.xz");
});

test("assertSupportedRunner rejects unsupported platforms and architectures", () => {
  assert.throws(() => __test.assertSupportedRunner("darwin", "arm64"), /supports Linux runners only/);
  assert.throws(() => __test.assertSupportedRunner("linux", "arm"), /supports Linux x64 and arm64 runners only/);
});

test("renderConfig encodes the password and includes selected toggles", () => {
  const config = __test.renderConfig({
    serverName: "vpn.example.com:443",
    loginType: "vpn_Username_Password",
    userName: "alice",
    password: "s3cr3t!",
    defaultRoute: true,
    ignoreServerCert: false,
    tunnelType: "ipsec",
    logLevel: "debug",
    caCert: "/etc/ssl/custom.pem",
  });

  assert.match(config, /^server-name=vpn\.example\.com:443/m);
  assert.match(config, /^login-type=vpn_Username_Password/m);
  assert.match(config, /^user-name=alice/m);
  assert.match(config, /^password=czNjcjN0IQ==/m);
  assert.match(config, /^default-route=true/m);
  assert.match(config, /^ignore-server-cert=false/m);
  assert.match(config, /^tunnel-type=ipsec/m);
  assert.match(config, /^log-level=debug/m);
  assert.match(config, /^ca-cert=\/etc\/ssl\/custom\.pem/m);
  assert.match(config, /^locale=en-US/m);
});

test("status helpers distinguish connected standalone log markers", () => {
  const connected = {
    exitCode: 0,
    stdout: "Connected since: 2026-04-15 12:00:00\n",
    stderr: "",
  };

  assert.equal(__test.logShowsConnected("Tunnel connected, press Ctrl-C to exit.\n"), true);
  assert.equal(__test.logShowsConnected("Connected since: 2026-04-15 12:00:00\n"), true);
  assert.equal(__test.logShowsConnected("Connecting...\n"), false);
  assert.equal(__test.isConnectedResult(connected), true);
});

test("parsePositiveInteger falls back for invalid values", () => {
  assert.equal(__test.parsePositiveInteger("90", __test.DEFAULT_CONNECT_TIMEOUT_SECONDS), 90);
  assert.equal(__test.parsePositiveInteger("0", __test.DEFAULT_CONNECT_TIMEOUT_SECONDS), __test.DEFAULT_CONNECT_TIMEOUT_SECONDS);
  assert.equal(
    __test.parsePositiveInteger("not-a-number", __test.DEFAULT_CONNECT_TIMEOUT_SECONDS),
    __test.DEFAULT_CONNECT_TIMEOUT_SECONDS,
  );
});
