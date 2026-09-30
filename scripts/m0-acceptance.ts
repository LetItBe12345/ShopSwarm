// Install into a fresh DSH profile, then run a genuine CLI shopping task.
// Actual quote correctness is manually reviewed from the saved root/child logs.
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { withoutProxy } from '../src/direct-env.js'

const output = join(process.cwd(), 'runtime', 'single-tool-acceptance-' + Date.now())
await mkdir(output, { recursive: true, mode: 0o700 })
const profile = 'shopswarm-acceptance-' + Date.now()
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profile)
await mkdir(profileDir, { recursive: true, mode: 0o700 })
await writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'dsh-profile-' + profile, private: true, type: 'module', dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } } }), { mode: 0o600 })
for (const name of ['cordis.yml', 'cordis.patch.yml']) await writeFile(join(profileDir, name), '[]\n', { mode: 0o600 })
const commands = [
  ['pnpm', ['build']],
  ['pnpm', ['pack', '--pack-destination', output]],
  [process.execPath, ['--import', 'tsx', 'scripts/install-dsh-plugin.ts', profile, join(output, 'shopswarm-0.3.0.tgz')]],
] as const
for (const [bin, args] of commands) {
  const result = spawnSync(bin, args, { encoding: 'utf8', env: withoutProxy(), maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`${bin} failed: ${result.stderr}`)
}
const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
if (!manifest.dsh.profile.bundles.includes('shopswarm')) throw new Error('installed bundle missing')
await writeFile(join(output, 'installation.json'), JSON.stringify({ profile, cleanProfileInstall: true, bundles: manifest.dsh.profile.bundles }), { mode: 0o600 })
console.log(JSON.stringify({ profile, output, phase: 'installed' }))
const result = spawnSync('python3', ['scripts/evaluate-shopping.py', '--profile', profile, '--case', 'iphone', '--output', join(output, 'cli')], { stdio: 'inherit', env: withoutProxy() })
if (result.status !== 0) throw new Error('real CLI task failed; inspect private records')
console.log(JSON.stringify({ profile, output, phase: 'recorded', assessment: 'manual review required; exit zero is not shopping success' }))
