# setup-snx-rs-vpn-action

GitHub Action for installing [`snx-rs`](https://github.com/ancwrd1/snx-rs), starting command mode, connecting to a Check Point VPN tunnel, and automatically disconnecting in the post step.

This action is modeled after post-cleanup actions like `Boostport/setup-cloudflare-warp`, but it uses [`ancwrd1/snx-rs`](https://github.com/ancwrd1/snx-rs) and vendors the installer logic directly so it can expose a JavaScript `post` hook.

## Usage

```yaml
steps:
  - uses: actions/checkout@v6

  - name: Connect to Check Point VPN
    uses: coretech-asia/setup-snx-rs-vpn-action@v1
    with:
      server-name: vpn.example.com
      login-type: vpn_Username_Password
      user-name: ${{ secrets.CHECKPOINT_USER }}
      password: ${{ secrets.CHECKPOINT_PASSWORD }}
      version: latest

  - name: Access protected resource
    run: curl -f https://internal.example.com/healthz
```

The action disconnects the tunnel automatically in its post step after the job finishes.

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `version` | No | `latest` | `snx-rs` release tag to install. Both `v5.3.0` and `5.3.0` are accepted. |
| `server-name` | Yes |  | VPN server host, optionally including the port. |
| `login-type` | Yes |  | Explicit `vpn_...` login type from `snx-rs -m info -s <server>`. |
| `user-name` | Yes |  | VPN user name. |
| `password` | Yes |  | VPN password. The action base64-encodes it in the generated config. |
| `default-route` | No | `false` | Route all traffic through the tunnel. |
| `ignore-server-cert` | No | `false` | Disable TLS certificate validation. Not recommended. |
| `tunnel-type` | No |  | Tunnel type, for example `ipsec` or `ssl`. |
| `log-level` | No | `info` | `snx-rs` log level used by the background command daemon. |
| `ca-cert` | No |  | Optional comma-separated CA certificate paths. |
| `connect-timeout-seconds` | No | `60` | Timeout for daemon startup and VPN connection. |

## Outputs

| Name | Description |
| --- | --- |
| `installed-version` | The resolved `snx-rs` release tag that was installed. |
| `connected` | `true` after standalone `snx-rs` reports the tunnel is connected. |

## Notes

- Supported runners: Linux `x64` and `arm64`.
- This action supports username/password authentication only.
- `login-type` must be provided explicitly. Discover it with `snx-rs -m info -s <server>`.
- The action starts `sudo snx-rs -m standalone` in the background and assumes passwordless `sudo` is available on the runner.
- The generated `snx-rs.conf` is written to a temporary directory, used only for the job, and removed in cleanup.

## Development

```bash
npm install
npm test
npm run build
```

`main` stays source-first and keeps `dist/` ignored. The publish workflow builds `dist/index.js` from the release tag and updates the published action tag, matching the `setup-snx-rs-action` release pattern.

## Local E2E

For local `act`-based end-to-end runs against a real VPN, use the harness in [e2e/README.md](/home/flame/Desktop/Projects/Coretech/gs25/snx-rs-action/e2e/README.md). It provides a privileged runner image, an `act` wrapper script, and a secrets template for `/dev/net/tun`-capable runs.
