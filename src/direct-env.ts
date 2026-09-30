export const proxyEnvironmentNames = [
  'AGENT_BROWSER_PROXY',
  'AGENT_BROWSER_PROXY_BYPASS',
  'ALL_PROXY',
  'all_proxy',
  'FTP_PROXY',
  'ftp_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
] as const

export const foregroundBrowserNames = [
  'AGENT_BROWSER_AUTO_CONNECT',
  'AGENT_BROWSER_CDP',
  'AGENT_BROWSER_HEADED',
  'AGENT_BROWSER_PROFILE',
  'AGENT_BROWSER_STATE',
  'AGENT_BROWSER_SESSION_NAME',
  'AGENT_BROWSER_ARGS',
  'AGENT_BROWSER_EXTENSIONS',
  'AGENT_BROWSER_PROVIDER',
] as const

export function withoutProxy(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env }
  for (const name of proxyEnvironmentNames) delete next[name]
  return next
}

export function backgroundBrowserEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const next = withoutProxy(env)
  for (const name of foregroundBrowserNames) delete next[name]
  return next
}
