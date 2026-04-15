import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

function runScript(relativePath) {
  const absolutePath = resolve(relativePath)

  execFileSync(process.execPath, [absolutePath], {
    env: process.env,
    stdio: 'inherit',
  })
}

runScript('./scripts/provision-search.mjs')
runScript('./scripts/provision-static-web-app-auth.mjs')
