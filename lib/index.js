/**
 * Semble MCP bundle — host-side anchor plugin.
 *
 * This bundle's real work is done by the `@deepseek-ai/dsh-mcp-client` row declared
 * next to this one in cordis.patch.yml. That row loads the MCP client under its own
 * module name, so a running host has no loader entry named after this package.
 *
 * DSH's plugin inventory and the Plugin Hub determine "loaded" by matching loader
 * entry names against the installed npm package name (`isEntryLoaded`), so without
 * an entry of our own the plugin is reported as 未加载 / 待重启 even while its MCP
 * tools are registered and working.
 *
 * This no-op host plugin gives the bundle a stable loader entry named
 * `@local/semble-mcp` so the running state is reported correctly. It deliberately
 * registers nothing: the MCP connection remains the single place where behaviour
 * is configured, and it has no services to inject.
 */
export const name = 'semble-mcp'

/** No-op plugin: present only so the loader has an entry under this package name. */
export default function sembleMcpBundle() {}
