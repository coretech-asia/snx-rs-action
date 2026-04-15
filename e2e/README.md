# E2E with `act`

This directory contains a local end-to-end harness for exercising the action against a real Check Point VPN from this workspace.

The harness assumes:

- Docker is available locally
- [`act`](https://github.com/nektos/act) is installed
- your local machine can provide a privileged container with `/dev/net/tun`
- you have valid VPN credentials and an explicit `vpn_...` login type

## Files

- `runner/Dockerfile`: custom `act` runner image with `sudo`, networking tools, and a passwordless `runner` sudo policy
- `run-act.sh`: builds the runner image and invokes `act` with `--privileged` and `/dev/net/tun`
- `secrets.env.example`: template for the secrets file consumed by `act`

## Prepare secrets

Copy the template and fill in real values:

```bash
cp e2e/secrets.env.example e2e/secrets.env
```

Required values:

- `CHECKPOINT_SERVER`
- `CHECKPOINT_LOGIN_TYPE`
- `CHECKPOINT_USER`
- `CHECKPOINT_PASSWORD`

Optional values:

- `CHECKPOINT_TUNNEL_TYPE`
- `CHECKPOINT_IGNORE_SERVER_CERT`
- `CHECKPOINT_CA_CERT`
- `CHECKPOINT_PROBE_URL`

If your gateway certificate does not match the host value you are using in `CHECKPOINT_SERVER`, you can temporarily set `CHECKPOINT_IGNORE_SERVER_CERT=true` for local validation runs.

## Run locally

```bash
./e2e/run-act.sh
```

The script:

1. builds the custom `act` runner image
2. runs `.github/workflows/e2e.yml`
3. passes `--privileged`
4. mounts `/dev/net/tun`
5. adds `NET_ADMIN` and `NET_RAW` capabilities

## Notes

- The workflow builds `dist/index.js` before invoking the local action, matching the repo's source-first release model.
- After the VPN connection is established, the workflow runs a separate SSH key scan stage against `172.18.9.24` and stores the result in `.tmp/ssh-known-hosts`.
- The action's post step runs at job teardown, so the workflow validates connect success and protected-resource access; disconnect is observed in the final action logs rather than a later workflow step.
- If your VPN requires a custom CA bundle, make sure the path you provide in `CHECKPOINT_CA_CERT` exists inside the `act` runner container.
