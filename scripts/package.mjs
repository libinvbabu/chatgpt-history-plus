// Builds and zips dist/ into release/chatgpt-history-plus-<version>.zip,
// ready to upload to the Chrome Web Store.
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
execFileSync('node', ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' })

const { version } = JSON.parse(await readFile(resolve(root, 'dist/manifest.json'), 'utf8'))
const outDir = resolve(root, 'release')
const zip = resolve(outDir, `chatgpt-history-plus-${version}.zip`)
await mkdir(outDir, { recursive: true })
await rm(zip, { force: true })

// Only what the extension needs: no source maps, tests or dotfiles.
const files = (await readdir(resolve(root, 'dist'), { recursive: true })).filter((f) => !f.endsWith('.map') && !f.split('/').some((p) => p.startsWith('.')))
execFileSync('zip', ['-q', '-X', zip, ...files], { cwd: resolve(root, 'dist') })
console.log(`\n${zip}`)
execFileSync('unzip', ['-l', zip], { stdio: 'inherit' })
