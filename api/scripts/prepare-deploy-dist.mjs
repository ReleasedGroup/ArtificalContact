import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const apiRoot = process.cwd()
const distRoot = path.join(apiRoot, 'dist')
const hostJsonPath = path.join(apiRoot, 'host.json')
const sourcePackageJsonPath = path.join(apiRoot, 'package.json')
const distPackageJsonPath = path.join(distRoot, 'package.json')

if (!existsSync(distRoot)) {
  throw new Error(`Build output directory not found: ${distRoot}`)
}

const sourcePackageJson = JSON.parse(readFileSync(sourcePackageJsonPath, 'utf8'))
const deployPackageJson = {
  name: sourcePackageJson.name,
  private: true,
  version: sourcePackageJson.version,
  type: sourcePackageJson.type,
  main: sourcePackageJson.main.replace(/^dist\//, ''),
  dependencies: sourcePackageJson.dependencies,
}

cpSync(hostJsonPath, path.join(distRoot, 'host.json'))
writeFileSync(distPackageJsonPath, `${JSON.stringify(deployPackageJson, null, 2)}\n`)

for (const entryName of ['tests']) {
  const entryPath = path.join(distRoot, entryName)
  if (existsSync(entryPath)) {
    rmSync(entryPath, { force: true, recursive: true })
  }
}
