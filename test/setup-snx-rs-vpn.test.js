const test = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../lib/setup-snx-rs-vpn");

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
