import { spawnSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const release = process.argv.includes('--release')
const targets = release ? [
  ['darwin', 'arm64'], ['darwin', 'amd64'], ['windows', 'amd64'], ['windows', 'arm64'],
] : [[process.platform === 'win32' ? 'windows' : process.platform, { x64: 'amd64', arm64: 'arm64' }[process.arch]]]

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' && command === 'npm' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npm', ['--prefix', 'web', 'run', 'build'])
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true })
for (const [os, arch] of targets) {
  if (!arch) throw new Error(`Unsupported build architecture: ${process.arch}`)
  const name = release ? `landrop-${os}-${arch}` : 'landrop'
  const output = `dist/${name}${os === 'windows' ? '.exe' : ''}`
  run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', output, './cmd/landrop'], {
    ...process.env, CGO_ENABLED: '0', GOOS: os, GOARCH: arch,
  })
  const size = statSync(new URL(`../${output}`, import.meta.url)).size
  console.log(`${output}  ${(size / 1024 ** 2).toFixed(2)} MiB`)
  if (size > 10 * 1024 ** 2) throw new Error(`${output} exceeds the 10 MiB size budget`)
}
