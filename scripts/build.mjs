// Builds the two extension entry points as classic (IIFE) scripts.
// MV3 content scripts cannot be ES modules, and Vite's IIFE lib mode
// only accepts one entry, so we run one build per entry.
import { build } from 'vite'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'dist')
const watch = process.argv.includes('--watch')

const entries = [
  { name: 'content', entry: 'src/content/index.ts' },
  { name: 'background', entry: 'src/background/index.ts' },
]

await rm(outDir, { recursive: true, force: true })

for (const { name, entry } of entries) {
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    publicDir: name === 'content' ? 'public' : false,
    define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
    build: {
      outDir,
      emptyOutDir: false,
      minify: !watch,
      sourcemap: watch ? 'inline' : false,
      target: 'chrome111',
      watch: watch ? {} : null,
      lib: {
        entry: resolve(root, entry),
        formats: ['iife'],
        name: `chp_${name}`,
        fileName: () => `${name}.js`,
      },
    },
  })
}

// package.json is the single source of truth for the version.
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const manifestPath = resolve(outDir, 'manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.version = pkg.version
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

if (!watch) {
  console.log(`manifest v${manifest.version}`)
  for (const { name } of entries) {
    const file = resolve(outDir, `${name}.js`)
    const raw = await readFile(file)
    const { size } = await stat(file)
    console.log(`${name}.js  ${(size / 1024).toFixed(1)} KB  (gzip ${(gzipSync(raw).length / 1024).toFixed(1)} KB)`)
  }
}
