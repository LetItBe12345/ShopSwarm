import { homedir } from 'node:os'
import { join } from 'node:path'

export interface RuntimePaths {
  readonly configDir: string
  readonly stateDir: string
  readonly cacheDir: string
}

export function resolveRuntimePaths(env: NodeJS.ProcessEnv = process.env): RuntimePaths {
  const home = env.HOME || homedir()
  return {
    configDir: env.XDG_CONFIG_HOME
      ? join(env.XDG_CONFIG_HOME, 'shopswarm')
      : join(home, '.config', 'shopswarm'),
    stateDir: env.XDG_STATE_HOME
      ? join(env.XDG_STATE_HOME, 'shopswarm')
      : join(home, '.local', 'state', 'shopswarm'),
    cacheDir: env.XDG_CACHE_HOME
      ? join(env.XDG_CACHE_HOME, 'shopswarm')
      : join(home, '.cache', 'shopswarm'),
  }
}
