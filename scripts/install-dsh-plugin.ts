import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { withoutProxy } from '../src/direct-env.js'

interface PackageManifest {
  readonly packageManager?: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly dsh?: {
    readonly bundle?: { readonly patch?: string | readonly string[] }
    readonly profile?: { readonly bundles?: readonly string[] }
  }
}

const execFileAsync = promisify(execFile)
process.env.DSH_HOME = process.env.SHOPSWARM_DSH_HOME ?? process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
const require = createRequire(import.meta.url)
const dshPackagePath = require.resolve('@deepseek-ai/dsh/package.json')
const dshPackage = require(dshPackagePath) as { version: string; bin?: { dsh?: string } }
const expectedDsh = (require('../package.json') as { engines: { dsh: string } }).engines.dsh
if (dshPackage.version !== expectedDsh) {
  throw new Error(`ShopSwarm requires DSH ${expectedDsh}; installed ${dshPackage.version}`)
}
const dshBin = join(dirname(dshPackagePath), dshPackage.bin?.dsh ?? 'lib/bin.js')

function usage(): never {
  throw new Error('usage: pnpm install:dsh -- <profile> <package-spec>')
}

function profileDir(profile: string): string {
  const home = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
  if (!home) throw new Error('DSH_HOME or HOME is required')
  return join(home, 'profiles', profile)
}

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

async function reconcileBundles(dir: string): Promise<readonly string[]> {
  const manifestPath = join(dir, 'package.json')
  const manifest = await readManifest(manifestPath)
  const current = manifest.dsh?.profile?.bundles ?? []
  const bundles = [...current]
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    let installed: PackageManifest
    try {
      installed = await readManifest(join(dir, 'node_modules', name, 'package.json'))
    } catch {
      continue
    }
    if (installed.dsh?.bundle?.patch !== undefined && !bundles.includes(name)) bundles.push(name)
  }
  const changed = bundles.length !== current.length || bundles.some((name, index) => name !== current[index])
  if (changed) {
    const updated = { ...manifest, dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } } }
    await writeFile(manifestPath, `${JSON.stringify(updated, null, 2)}\n`)
  }
  return bundles
}

async function allowAgentBrowserBuild(dir: string): Promise<void> {
  const path = join(dir, 'pnpm-workspace.yaml')
  let content = ''
  try { content = await readFile(path, 'utf8') } catch { /* DSH creates this file on profile initialization. */ }
  if (/^\s*agent-browser:\s*true\s*$/m.test(content)) return
  if (/^\s*agent-browser:\s*.*$/m.test(content)) {
    await writeFile(path, content.replace(/^\s*agent-browser:\s*.*$/m, '  agent-browser: true'))
    return
  }
  const suffix = content.endsWith('\n') || content.length === 0 ? '' : '\n'
  await writeFile(path, `${content}${suffix}allowBuilds:\n  agent-browser: true\n`)
}

const args = process.argv.slice(2).filter((value, index) => !(index === 0 && value === '--'))
const [profile, packageSpec] = args
if (!profile || !packageSpec) usage()

const dir = profileDir(profile)
// Corepack otherwise chooses its global pnpm version when cwd changes to the profile.
const dshRequire = createRequire(dshPackagePath)
const { initProfile, PROFILE_TEMPLATES, DEFAULT_PROFILE_BUNDLES } = await import(
  pathToFileURL(dshRequire.resolve('@deepseek-ai/dsh-app-boot')).href
)
initProfile(dir, PROFILE_TEMPLATES[profile]?.bundles ?? DEFAULT_PROFILE_BUNDLES)
const profileManifestPath = join(dir, 'package.json')
const profileManifest = await readManifest(profileManifestPath)
const packageManager = (require('../package.json') as { packageManager: string }).packageManager
await writeFile(profileManifestPath, `${JSON.stringify({ ...profileManifest, packageManager }, null, 2)}\n`)
await execFileAsync(process.execPath, [dshBin, 'plugin', '--profile', profile, 'install'], { env: withoutProxy() })
await allowAgentBrowserBuild(dir)
const result = await execFileAsync(process.execPath, [dshBin, 'plugin', '--profile', profile, 'add', packageSpec], { env: withoutProxy() })
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
const bundles = await reconcileBundles(dir)
process.stdout.write(`ShopSwarm: active DSH bundles: ${bundles.join(', ')}\n`)
