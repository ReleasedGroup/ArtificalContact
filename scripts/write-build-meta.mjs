import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'

const [, , targetPath, identifier] = process.argv

if (!targetPath || !identifier) {
  throw new Error(
    'Usage: node scripts/write-build-meta.mjs <target-path> <identifier>',
  )
}

const fallbackSha = 'local-dev'

const buildSha =
  process.env.VITE_BUILD_SHA ??
  process.env.BUILD_SHA ??
  process.env.GITHUB_SHA ??
  fallbackSha

const source = `export const ${identifier} = '${buildSha}' as const\n`

writeFileSync(resolve(targetPath), source, 'utf8')
