const proxyEnvironmentNames = [
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

export function withoutProxy(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env }
  for (const name of proxyEnvironmentNames) delete next[name]
  return next
}
