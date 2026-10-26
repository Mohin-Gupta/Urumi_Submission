# System design and tradeoffs

This note explains how the system works and why we made each main choice.
For setup steps, see the [README](../README.md).

## Components

| Component | Responsibility |
|---|---|
| WordPress + WooCommerce | The store. It keeps products and orders in MariaDB. |
| `store-setup` Job | Installs and configures the store. It runs after each `helm install` and `helm upgrade`, and it is safe to run again. |
| `woo-mcp` | Our MCP server for the store. It changes MCP tool calls into WooCommerce REST API calls. |
| `notes-mcp` | A small second MCP server for team notes. |
| `everything-mcp` | The official MCP reference server. It shows that the gateway works with code that we did not write. |
| `gateway` | An MCP client to each upstream server, and one MCP server for the team. It also has the REST API and the chat agent. |
| `postgres` | Gateway data: users, sessions, API keys, servers and the audit log. |
| `dashboard` | A React app. It uses only the gateway REST API. |

## Architecture choices

**One chart, one namespace.**
All components are in one Helm chart and one namespace.
NetworkPolicies, not namespaces, control which pod can speak to which pod.
This keeps the chart simple, and each policy is easy to read.

**Our own database StatefulSets.**
We do not use the Bitnami charts, because Bitnami moved most images to a paid catalog in 2025.
Plain StatefulSets with the official `mariadb` and `postgres` images are short and easy to explain.

**TypeScript and the official MCP SDK.**
All our services use TypeScript.
The gateway uses the SDK as a client to the upstreams and as a server to the team.
Thus, the protocol code on the two sides is the same.

**Stateless upstreams, stateful gateway.**
Our own MCP servers, `woo-mcp` and `notes-mcp`, make a new MCP server object for each request.
A restart loses no state.
The gateway keeps MCP sessions, because a session is necessary to send `tools/list_changed` notifications to clients.

## How `woo-mcp` talks to the store

`woo-mcp` uses the WooCommerce REST API v3 at `http://wordpress/wp-json/wc/v3`.

We chose the REST API for these reasons:

- It is the public and versioned API of WooCommerce. It applies all store rules, for example stock and order status changes.
- It uses a consumer key with `read_write` scope. The key can do store tasks only. It cannot change WordPress itself.
- It needs no Kubernetes permissions. WP-CLI would need `pods/exec` rights on the WordPress pod, which is a large privilege.
- Direct SQL would skip the WooCommerce logic and caches.

Helm generates the consumer key and keeps it in the Secret `store-secrets`.
The setup job writes the hash of the key into WooCommerce.

WooCommerce accepts key authentication only over HTTPS.
Inside the cluster the call uses HTTP, so `woo-mcp` sends `X-Forwarded-Proto: https`.
The WordPress image then treats the request as HTTPS.
This call never goes out of the cluster, and a NetworkPolicy lets only `woo-mcp` and the ingress controller reach WordPress.

## Tool aggregation

The gateway keeps one MCP client for each enabled upstream server.
A health loop lists the tools of each server.
The gateway then gives each tool a new name: `<server slug>__<tool name>`.

| Upstream | Upstream tool | Name for clients |
|---|---|---|
| `woo` | `list_orders` | `woo__list_orders` |
| `notes` | `echo` | `notes__echo` |
| `everything` | `echo` | `everything__echo` |

This prefix is our scheme for tool name collisions. We chose it for these reasons:

- Two servers can have the same tool name with no conflict.
- The name shows the user and the model which server does the work.
- Routing is simple. The gateway splits the name at the first `__`.
- A slug can contain only `a-z`, `0-9` and `-`. Thus, a slug cannot contain `__`, and the split is always correct.

Many clients and LLM APIs accept only tool names that match `^[a-zA-Z0-9_-]{1,64}$`.
One bad name can make them refuse the full list.
Thus, the gateway hides upstream tools with bad names, and the dashboard shows a warning for that server.

The gateway also adds the server name to each tool description, and it cuts descriptions to 1,000 characters.
See the [threat model](threat-model.md) for the reason.

## Routing a tool call

This is the path of one call, for example `woo__list_orders` from Claude Code:

1. Claude Code sends `tools/call` to `https://app.<domain>/mcp` with `Authorization: Bearer <key>`.
2. Traefik sends the request to the `gateway` Service.
3. The gateway calculates the SHA-256 hash of the key and finds it in Postgres. It does this for each request, so a revoked key stops immediately.
4. The gateway finds the MCP session of the client. A session belongs to one user, and only that user can use it.
5. `callTool()` splits the name into `woo` and `list_orders` and finds the upstream client for `woo`.
6. The upstream client sends `tools/call` to `http://woo-mcp/mcp`. It adds the upstream credential, if the server has one.
7. `woo-mcp` calls the WooCommerce REST API. WordPress reads the orders from MariaDB.
8. The result goes back the same way.
9. `callTool()` writes one audit row: user, server, tool, time, duration and result.

Before step 6, `callTool()` also checks the rate limit and the tool permissions. See the next section.

All tool calls go through `callTool()`.
This includes calls from MCP clients and calls from the chat agent.
Thus, routing, timeouts and the audit log are the same for each caller.

## Tool permissions and rate limits

Each server has a list of admin-only tools.
By default, `woo__create_product` and `woo__update_order_status` are admin-only.
An admin changes the list with the **Admins only** switch in the server row on the **Servers** page.

- `listTools()` removes admin-only tools for members. Thus, members do not see them in MCP clients, in the chat or in the dashboard.
- `callTool()` refuses a direct call from a member, and the audit log records it.
- A change sends `tools/list_changed`, so open clients get the new list.

`callTool()` also applies a rate limit of 60 calls each minute for each user.
The limit uses a token bucket, so short bursts are possible.
The limit is for each user, not for each key. Thus, more keys do not give more calls.

## Failure handling

| Problem | What the gateway does |
|---|---|
| Server is down | The health check fails. The server becomes **Unreachable**, with the cause, for example `ECONNREFUSED`. Its tools go out of the list. |
| Server is slow | Each check has a 5-second timeout. Each tool call has a 30-second timeout. The client gets a clear error, for example `Server "everything" timed out after 30s`. |
| One server fails | Each server has its own check. A check never throws an error. Thus, one bad server cannot block the list or calls to other servers. |
| Server restarts | The old MCP session becomes invalid. The check tries a new connection immediately in the same pass. A failed call also starts a new check. |
| Checks are slow | The next check starts only after the last check ends. Thus, checks cannot pile up. |
| Tool list changes | The gateway sends `notifications/tools/list_changed` to each open session. |
| Client goes away | The gateway closes sessions that are idle for 30 minutes. |

The gateway never sends a failed call again by itself.
A write tool, for example `create_product`, can fail after it did its work.
A second attempt could then do the work two times.

## Chat agent

The chat agent runs in the gateway process.

1. The browser sends the conversation to `POST /api/chat`. The session cookie identifies the user.
2. The gateway sends the conversation and the current tool list to the LLM.
3. If the LLM asks for tools, the gateway runs each tool with `callTool()` as the signed-in user.
4. The gateway sends the results to the LLM, and step 2 starts again.
5. The loop stops when the LLM gives an answer, or after 8 rounds.

If the LLM fails after some tools ran, the chat still shows those tool calls with the error.
Thus, the user can see changes that already happened, for example a new product.

The agent uses the same tool list, routing and audit as MCP clients.
The audit log shows its calls under the signed-in user, with the source "Chat".
We run the agent in the gateway process, so it does not need an API key of its own.

The agent uses the OpenAI-compatible chat API.
Gemini is the default. Groq and other providers need only new Helm values.

## Production changes

The same chart runs on k3d and on k3s. Only the values file changes.
For this submission, we did not deploy to a live VPS. We tested on k3d, and we checked `values-prod.yaml` with `helm lint` and `helm template`.

| Item | Local | Production | Why |
|---|---|---|---|
| DNS | `*.127.0.0.1.nip.io` | `<vps-ip>.nip.io` or A records for a real domain | Public names must resolve to the VPS |
| Ingress | Traefik, HTTP | Traefik, HTTPS | k3s also includes Traefik, so the Ingress objects are the same |
| TLS | None | cert-manager with Let's Encrypt | The chart can create the ClusterIssuer |
| Storage | `local-path`, 1–2 Gi | `local-path` or a cloud volume class, 5–10 Gi | A cloud class keeps data if the node fails |
| Images | Imported into k3d | Pulled from a registry | A VPS cannot see images on a laptop |
| Secrets | Generated by Helm | Generated by Helm, or created before install | See below |

**Secrets.**
At the first install, Helm generates each password and key.
At each upgrade, Helm reads the old value from the cluster and uses it again.
The Secrets have `helm.sh/resource-policy: keep`, so an uninstall does not delete them.
A team with more needs can create the Secrets with Sealed Secrets or External Secrets.
On k3s, also enable `--secrets-encryption`, so etcd keeps the Secrets encrypted.

## Tradeoffs and limits

- **One gateway replica.** MCP sessions are in memory. Two replicas would need sticky sessions or a shared session store.
- **Polling for health.** The gateway checks each server every 10 seconds. A dashboard status can be up to 10 seconds old.
- **Notes in memory.** `notes-mcp` loses its notes when its pod restarts. It is only a demo server.
- **Two levels of tool rules.** A tool is for everyone or for admins only. Per-user rules would need a rule table.
- **Rate limit in memory.** Each gateway replica has its own counters. Two replicas would need a shared store, for example Redis.
- **All tools go to the LLM.** This is good for 24 tools. Hundreds of tools would need a "search tools" tool.
- **`local-path` storage.** The data is on one node. This is good for a demo VPS, but not for high availability.
