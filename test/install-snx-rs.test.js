const test = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../lib/install-snx-rs");

test("normalizeVersionedTag preserves latest and adds leading v when needed", () => {
  assert.equal(__test.normalizeVersionedTag("latest"), "latest");
  assert.equal(__test.normalizeVersionedTag("5.3.0"), "v5.3.0");
  assert.equal(__test.normalizeVersionedTag("v5.3.0"), "v5.3.0");
});

test("selectAsset prefers non-webkit tarballs over installers and packages", async () => {
  const asset = await __test.selectAsset(
    {
      assets: [
        { name: "snx-rs-v5.3.0-linux-x86_64.run" },
        { name: "snx-rs-v5.3.0-webkit-linux-x86_64.tar.xz" },
        { name: "snx-rs-v5.3.0-linux-x86_64.tar.xz" },
        { name: "snx-rs-v5.3.0-linux-x86_64.rpm" },
      ],
    },
    "linux",
    "x64",
  );

  assert.equal(asset.name, "snx-rs-v5.3.0-linux-x86_64.tar.xz");
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

test("selectAsset supports linux arm64 archive naming", async () => {
  const asset = await __test.selectAsset(
    {
      assets: [
        { name: "snx-rs-v5.3.0-linux-arm64.run" },
        { name: "snx-rs-v5.3.0-linux-arm64.tar.xz" },
      ],
    },
    "linux",
    "arm64",
  );

  assert.equal(asset.name, "snx-rs-v5.3.0-linux-arm64.tar.xz");
});

test("getAssetKind recognizes supported asset types", () => {
  assert.equal(__test.getAssetKind("snx-rs.tar.xz"), ".tar.xz");
  assert.equal(__test.getAssetKind("snx-rs.zip"), ".zip");
  assert.equal(__test.getAssetKind("snx-rs.run"), ".run");
  assert.equal(__test.getAssetKind("snx-rs.deb"), null);
});

test("assertSupportedRunner rejects unsupported platforms and architectures", () => {
  assert.throws(() => __test.assertSupportedRunner("darwin", "arm64"), /supports Linux runners only/);
  assert.throws(() => __test.assertSupportedRunner("linux", "arm"), /supports Linux x64 and arm64 runners only/);
});
