import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(scriptDirectory, '..')
const sourcePath = resolve(workspaceRoot, 'staticwebapp.config.json')
const destinationPath = resolve(workspaceRoot, 'dist', 'staticwebapp.config.json')

mkdirSync(dirname(destinationPath), { recursive: true })
copyFileSync(sourcePath, destinationPath)
