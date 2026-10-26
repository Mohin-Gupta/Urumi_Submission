<p align="center"><img src="docs/logo.svg" width="88" alt="Urumi logo"></p>

# Urumi MCP Gateway

A WooCommerce store and a team MCP gateway that run on Kubernetes.
An admin connects MCP servers one time.
Each team member then uses all the tools through one URL and one personal API key.

```
                       ┌──────────────── Kubernetes namespace "urumi" ────────────────┐
 Browser ── Ingress ───┼─▶ dashboard (React)                                          │
                       │                                                              │
 Claude Code ─ Ingress ┼─▶ gateway ──┬─▶ woo-mcp ───────▶ wordpress ──▶ mariadb       │
 Cursor, Inspector     │   │         ├─▶ notes-mcp                                    │
                       │   │         └─▶ everything-mcp                               │
                       │   ├─▶ postgres (users, keys, servers, audit log)             │
                       │   └─▶ LLM API (chat agent)                                   │
 Shopper ── Ingress ───┼─▶ wordpress (storefront)                                     │
                       └──────────────────────────────────────────────────────────────┘
```

## Highlights

- **One endpoint for all tools.** The gateway merges the tools of each enabled server into one MCP endpoint at `/mcp`.
- **Own WooCommerce MCP server.** It lists and creates products, and it lists, gets and updates orders.
- **Team access.** Admins and members have personal API keys. The gateway stores keys hashed, and an admin can revoke a key immediately.
- **Tool permissions and rate limits.** Admins can make a tool admin-only. Each user can make 60 tool calls each minute.
- **Audit log.** The gateway records each tool call with the user, server, tool, time, duration and result.
- **Chat agent.** The dashboard chat calls the same tools as the signed-in user.
- **Failure isolation.** A slow or dead upstream server does not stop the other servers. Each call has a timeout.
- **Credentials stay on the server.** The gateway encrypts upstream credentials and never sends them to a browser or an MCP client.
- **One Helm chart.** The same chart deploys to k3d on a laptop and to k3s on a VPS. Only the values file changes.

## Contents

- [What runs where](#what-runs-where)
- [Local setup](#local-setup)
- [Use the system](#use-the-system)
- [VPS setup](#vps-setup)
- [Upgrade and roll back](#upgrade-and-roll-back)
- [Configuration](#configuration)
- [Repository layout](#repository-layout)
- [More documents](#more-documents)
- [Stand-out items](#stand-out-items)

## What runs where

All workloads run in the namespace `urumi`.

| Component | Kind | Exposed | Purpose |
|---|---|---|---|
| `wordpress` | Deployment + PVC | Ingress `store.<domain>` | Storefront and WooCommerce admin |
| `mariadb` | StatefulSet + PVC | Internal only | Store database |
| `store-setup` | Job (Helm hook) | None | Installs WooCommerce, enables cash on delivery, creates the API key |
| `woo-mcp` | Deployment | Internal only | Our WooCommerce MCP server |
| `notes-mcp` | Deployment | Internal only | Second MCP server: team notes |
| `everything-mcp` | Deployment | Internal only | Third MCP server: the official MCP reference server |
| `gateway` | Deployment | Ingress `app.<domain>/api` and `/mcp` | MCP gateway, REST API and chat agent |
| `postgres` | StatefulSet + PVC | Internal only | Users, keys, servers and audit log |
| `dashboard` | Deployment | Ingress `app.<domain>/` | React dashboard |

NetworkPolicies deny all incoming traffic by default.
Only the gateway can reach the MCP servers.
Only `woo-mcp` and the ingress controller can reach WordPress.
The MCP servers and the databases cannot connect to the internet.

Each workload has readiness and liveness probes, and resource requests and limits.
Our own containers run as non-root users with a read-only root filesystem.

## Local setup

### Prerequisites

Install these tools:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/). Give it at least 6 GB of memory.
- [k3d](https://k3d.io), [kubectl](https://kubernetes.io/docs/tasks/tools/) and [Helm](https://helm.sh) 4.
- A Bash shell. On Windows, use Git Bash.

On Windows, you can install the tools with one command:

```powershell
winget install k3d.k3d Helm.Helm Kubernetes.kubectl
```

### Local domains

The local setup uses [nip.io](https://nip.io).
A name such as `store.127.0.0.1.nip.io` resolves to `127.0.0.1` through public DNS.
Thus, you do not edit the hosts file, and both browsers and MCP clients can resolve the names.

| URL | Use |
|---|---|
| http://store.127.0.0.1.nip.io | Storefront |
| http://store.127.0.0.1.nip.io/wp-admin | WooCommerce admin |
| http://app.127.0.0.1.nip.io | Dashboard |
| http://app.127.0.0.1.nip.io/mcp | Gateway MCP endpoint |

### Install

1. Clone the repository and go into it.

   ```bash
   git clone <repo-url> urumi && cd urumi
   ```

2. Create the cluster. The config maps ports 80 and 443 to your computer.

   ```bash
   k3d cluster create --config k3d.yaml
   ```

3. Build the images and import them into the cluster.

   ```bash
   ./scripts/build-images.sh
   ```

4. Install the chart. The first install takes approximately 5 minutes, because the setup job downloads WooCommerce.

   ```bash
   helm upgrade --install platform charts/platform -n urumi --create-namespace \
     -f charts/platform/values-local.yaml --wait --timeout 15m
   ```

5. Add a Gemini API key for the chat agent. Get a free key at [Google AI Studio](https://aistudio.google.com/apikey). Skip this step if you do not use the chat.

   ```bash
   kubectl -n urumi create secret generic llm-secrets --from-literal=api-key=<your-key>
   kubectl -n urumi rollout restart deploy/gateway
   ```

   The free tier allows a small number of requests each minute. If the chat shows a rate-limit message, wait one minute.
   To use a different provider, see [Configuration](#configuration).

### Get the passwords

Helm generates all passwords at the first install and keeps them in Kubernetes Secrets.

| Login | User | Password command |
|---|---|---|
| Dashboard | `admin@example.com` | `kubectl -n urumi get secret gateway-secrets -o jsonpath='{.data.admin-password}' \| base64 -d` |
| WooCommerce admin | `admin` | `kubectl -n urumi get secret store-secrets -o jsonpath='{.data.admin-password}' \| base64 -d` |

In PowerShell, decode a value with this command:

```powershell
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((kubectl -n urumi get secret gateway-secrets -o jsonpath='{.data.admin-password}')))
```

## Use the system

### Place an order

1. Open http://store.127.0.0.1.nip.io.
2. Select a product and click **Add to cart**.
3. Open the cart and click **Proceed to checkout**.
4. Fill in the billing details.
5. Select **Cash on delivery** and click **Place order**.
6. Open http://store.127.0.0.1.nip.io/wp-admin and log in as `admin`.
7. Go to **WooCommerce → Orders**. Make sure that the new order is in the list.

### Invite a team member

1. Log in to the dashboard as the admin.
2. Open **Team**.
3. Enter a name and an email, select a role, and click **Invite**.
4. Copy the invite link and send it to the person.
5. The person opens the link and sets a password.

### Connect an MCP client

Each person uses one URL and their own API key.
The person does not need the credentials of the upstream servers.

1. Log in to the dashboard.
2. Open **API keys**.
3. Enter a name for the key and click **Create key**.
4. Copy the key. The dashboard shows it only one time.

**Claude Code.** Run this command:

```bash
claude mcp add --transport http urumi http://app.127.0.0.1.nip.io/mcp \
  --header "Authorization: Bearer <your-key>"
```

Then run `/mcp` in Claude Code to see the tools.

**Cursor.** Add this entry to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "urumi": {
      "url": "http://app.127.0.0.1.nip.io/mcp",
      "headers": { "Authorization": "Bearer <your-key>" }
    }
  }
}
```

**MCP Inspector.** Run this command:

```bash
npx @modelcontextprotocol/inspector --cli http://app.127.0.0.1.nip.io/mcp \
  --transport http --header "Authorization: Bearer <your-key>" --method tools/list
```

### Tool names

Each tool name has the form `<server>__<tool>`, for example `woo__list_orders`.
Thus, two servers can have a tool with the same name.
For example, `notes__echo` and `everything__echo` are different tools.

### Use the chat agent

1. Log in to the dashboard.
2. Open **Chat**.
3. Type a question, for example "What orders came in today?".
4. Press Enter.

The chat shows each tool call above the answer.
Click a tool call to see its arguments and result.
The audit log shows these calls under your name, with the source "Chat".

Example prompts:

- "Create a product called Demo Mug priced at 299." By default, only admins can create products.
- "What orders came in today?"
- "Add a team note for each of today's orders." This prompt uses tools from two servers.

### Control access

| Action | Where | Result |
|---|---|---|
| Revoke a key | **API keys → Revoke** | The next request with that key gets HTTP 401. |
| Disable a server | **Servers → Disable** | Its tools go out of the tool list. Connected clients get a `tools/list_changed` notification. |
| Remove a person | **Team → Remove** | All the keys of that person stop working. |
| Make a tool admin-only | **Servers → tools → Admins only** | Members do not see the tool, and a direct call gets an error. |
| See usage | **Metrics** | Calls, errors, and p50 and p95 latency for each server and tool, for the last 24 hours. |

By default, `woo__create_product` and `woo__update_order_status` are admin-only.
Members can still read products and orders.

To see a dead upstream, stop one MCP server:

```bash
kubectl -n urumi scale deploy/everything-mcp --replicas=0
```

After approximately 10 seconds, the dashboard shows the server as **Unreachable**, with the cause.
The other servers continue to work.
To start the server again, set `--replicas=1`.

## VPS setup

This procedure uses a VPS with Ubuntu and k3s.
The same chart is used. Only `values-prod.yaml` changes.

### Prepare the VPS

1. Get a VPS with at least 2 vCPUs and 4 GB of memory.
2. Open ports 22, 80 and 443 in the firewall.
3. Install k3s.

   ```bash
   curl -sfL https://get.k3s.io | sh -
   ```

4. Install Helm.

   ```bash
   curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4 | bash
   ```

5. Install cert-manager for TLS certificates.

   ```bash
   helm install cert-manager oci://quay.io/jetstack/charts/cert-manager --version v1.21.3 \
     -n cert-manager --create-namespace --set crds.enabled=true
   ```

### Publish the images

1. On your computer, log in to GitHub Container Registry.

   ```bash
   echo <github-token> | docker login ghcr.io -u <github-user> --password-stdin
   ```

2. Build and push the images.

   ```bash
   ./scripts/build-images.sh ghcr.io/<github-user>/
   ```

3. In GitHub, set each new package to **Public**. Otherwise, the VPS cannot pull the images.

### Install the chart

1. Copy the repository to the VPS.
2. Edit `charts/platform/values-prod.yaml`. Replace each `CHANGE_ME` value.
3. Install the chart.

   ```bash
   export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
   helm upgrade --install platform charts/platform -n urumi --create-namespace \
     -f charts/platform/values-prod.yaml --wait --timeout 15m
   ```

4. Add the LLM key, as in step 5 of the local install.
5. Open `https://app.<domain>`.

### What changes between local and VPS

| Item | Local (`values-local.yaml`) | VPS (`values-prod.yaml`) |
|---|---|---|
| Domain | `127.0.0.1.nip.io` | `<vps-ip>.nip.io` or a real domain |
| TLS | None | cert-manager with Let's Encrypt |
| Images | Imported into k3d | Pulled from `ghcr.io/<user>/` |
| Storage | k3d `local-path`, 1–2 Gi | k3s `local-path`, 5–10 Gi, or a cloud volume class |
| Secrets | Generated by Helm at first install | Same. The LLM key is created by hand. |
| Ingress | Traefik from k3d | Traefik from k3s |

## Upgrade and roll back

To upgrade a component, change its image tag or version in `values.yaml`.
Then build the images and upgrade the release:

```bash
./scripts/build-images.sh
helm upgrade platform charts/platform -n urumi -f charts/platform/values-local.yaml \
  --rollback-on-failure --timeout 10m
```

With `--rollback-on-failure`, Helm rolls back by itself if the new pods do not become ready.
During the upgrade, the old pods continue to serve requests.

To roll back by hand, find the last good revision and roll back to it:

```bash
helm history platform -n urumi
helm rollback platform <revision> -n urumi --wait
```

Know these limits:

- **WordPress.** Core files are on the volume. The setup job updates them to `store.wordpressVersion` at each upgrade. A rollback does not downgrade the database.
- **Gateway.** The gateway creates its tables at start. New versions must only add tables or columns, so an old version can still run.
- **Secrets.** Helm keeps generated Secrets after `helm uninstall`. Thus, a new install can still open the old volumes.

## Configuration

These values are the most useful. See [`values.yaml`](charts/platform/values.yaml) for all values.

| Value | Default | Description |
|---|---|---|
| `domain` | `127.0.0.1.nip.io` | Base domain for `store.` and `app.` |
| `ingress.tls` | `false` | Enables HTTPS on the Ingresses |
| `imageRegistry` | `""` | Prefix for our images, with a trailing slash |
| `storageClass` | `""` | StorageClass for all volumes. Empty means the cluster default. |
| `store.timezone` | `Asia/Kolkata` | Store timezone. "Today" in `list_orders` uses this timezone. |
| `gateway.callTimeoutMs` | `30000` | Timeout for each tool call |
| `gateway.rateLimitPerMinute` | `60` | Tool calls each minute for each user |
| `gateway.seedServers` | 3 servers | Servers that the gateway registers at first start |
| `llm.baseUrl` | Gemini | Any OpenAI-compatible API |
| `llm.model` | `gemini-2.5-flash` | Model for the chat agent |

The chat agent works with each API that is compatible with OpenAI. For example, to use Groq, set these values and put a Groq key in `llm-secrets`:

```yaml
llm:
  baseUrl: https://api.groq.com/openai/v1
  model: openai/gpt-oss-120b
```

## Repository layout

```
apps/
  mcp-servers/   WooCommerce and notes MCP servers (one image, two entrypoints)
  everything/    Image for the official MCP reference server
  gateway/       MCP gateway, REST API, chat agent
  dashboard/     React dashboard
charts/platform/ Helm chart with values-local.yaml and values-prod.yaml
scripts/         Image build script
docs/            Design note and threat model
k3d.yaml         Local cluster config
```

## More documents

- [System design and tradeoffs](docs/design.md): architecture, tool routing, failure handling and production changes.
- [Threat model](docs/threat-model.md): credentials, tokens, untrusted upstreams and risks between team members.

## Stand-out items

| Item | Status | Where |
|---|---|---|
| 2. Tool permissions | Admin-only tools are hidden from members and refused if called. Admins change them on the Servers page. | [`upstreams.ts`](apps/gateway/src/upstreams.ts) (`canUse`), [`mcp.ts`](apps/gateway/src/mcp.ts) (`callTool`), [Servers page](apps/dashboard/src/pages/Servers.tsx) |
| 6. Security hardening | SSRF protection for upstream URLs, upstream credentials encrypted at rest, ingress and egress NetworkPolicies, non-root containers | [`urlGuard.ts`](apps/gateway/src/urlGuard.ts), [`crypto.ts`](apps/gateway/src/crypto.ts), [`networkpolicies.yaml`](charts/platform/templates/networkpolicies.yaml) |
| 7. Scaling (rate limits only) | A token bucket for each user, shared by all keys of that user and the chat | [`rateLimit.ts`](apps/gateway/src/rateLimit.ts) |
| 8. Observability | Metrics page with calls, error rate, and p50 and p95 latency for each server and tool. The dashboard also shows why an upstream is unreachable and why a call failed. | [Metrics page](apps/dashboard/src/pages/Metrics.tsx), `GET /api/metrics` in [`api.ts`](apps/gateway/src/api.ts) |
| 9. Upgrades and rollback | Tested automatic and manual rollback | [Upgrade and roll back](#upgrade-and-roll-back) |
