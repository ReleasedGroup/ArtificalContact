import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const distDirectory = path.resolve(scriptDirectory, '..', 'dist')
const manifestPath = path.join(distDirectory, '.vite', 'manifest.json')
const budgetConfigPath = path.join(scriptDirectory, 'bundle-budgets.json')

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function formatKilobytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

function readGzipSize(filePath) {
  return gzipSync(readFileSync(filePath)).length
}

function collectEntryAssets(manifest, entryKey) {
  const visited = new Set()
  const javascriptFiles = new Set()
  const cssFiles = new Set()
  const asyncJavascriptFiles = new Set()

  function visit(key, isDynamicImport = false) {
    if (visited.has(key)) {
      return
    }

    visited.add(key)

    const entry = manifest[key]
    if (!entry) {
      throw new Error(`Bundle manifest entry "${key}" was not found.`)
    }

    if (typeof entry.file === 'string' && entry.file.endsWith('.js')) {
      if (isDynamicImport) {
        asyncJavascriptFiles.add(entry.file)
      } else {
        javascriptFiles.add(entry.file)
      }
    }

    for (const cssFile of entry.css ?? []) {
      cssFiles.add(cssFile)
    }

    for (const importKey of entry.imports ?? []) {
      visit(importKey, false)
    }

    for (const importKey of entry.dynamicImports ?? []) {
      visit(importKey, true)
    }
  }

  visit(entryKey)

  return {
    javascriptFiles: [...javascriptFiles],
    cssFiles: [...cssFiles],
    asyncJavascriptFiles: [...asyncJavascriptFiles],
  }
}

function sumGzipSizes(files) {
  return files.reduce(
    (total, relativeFilePath) =>
      total + readGzipSize(path.join(distDirectory, relativeFilePath)),
    0,
  )
}

function readRawSize(relativeFilePath) {
  return statSync(path.join(distDirectory, relativeFilePath)).size
}

function assertBudget(label, actualBytes, maxBytes) {
  if (actualBytes > maxBytes) {
    throw new Error(
      `${label} exceeded the gzip budget: ${formatKilobytes(actualBytes)} > ${formatKilobytes(maxBytes)}.`,
    )
  }
}

const manifest = readJson(manifestPath)
const budgets = readJson(budgetConfigPath)
const entryKey = Object.keys(manifest).find((key) => manifest[key]?.isEntry)

if (!entryKey) {
  throw new Error('Unable to identify the Vite entry chunk in the manifest.')
}

const assets = collectEntryAssets(manifest, entryKey)
const entryJavascriptGzip = sumGzipSizes(assets.javascriptFiles)
const entryCssGzip = sumGzipSizes(assets.cssFiles)
const asyncJavascriptGzip = sumGzipSizes(assets.asyncJavascriptFiles)
const totalJavascriptGzip = entryJavascriptGzip + asyncJavascriptGzip

const lines = [
  `Bundle budget summary for ${entryKey}:`,
  `- entry JavaScript: ${formatKilobytes(entryJavascriptGzip)} gzip across ${assets.javascriptFiles.length} file(s)`,
  `- entry CSS: ${formatKilobytes(entryCssGzip)} gzip across ${assets.cssFiles.length} file(s)`,
  `- async JavaScript: ${formatKilobytes(asyncJavascriptGzip)} gzip across ${assets.asyncJavascriptFiles.length} file(s)`,
  `- total JavaScript: ${formatKilobytes(totalJavascriptGzip)} gzip`,
]

for (const filePath of assets.javascriptFiles) {
  lines.push(
    `  JS ${filePath}: ${formatKilobytes(readRawSize(filePath))} raw / ${formatKilobytes(readGzipSize(path.join(distDirectory, filePath)))} gzip`,
  )
}

for (const filePath of assets.cssFiles) {
  lines.push(
    `  CSS ${filePath}: ${formatKilobytes(readRawSize(filePath))} raw / ${formatKilobytes(readGzipSize(path.join(distDirectory, filePath)))} gzip`,
  )
}

for (const filePath of assets.asyncJavascriptFiles) {
  lines.push(
    `  Async JS ${filePath}: ${formatKilobytes(readRawSize(filePath))} raw / ${formatKilobytes(readGzipSize(path.join(distDirectory, filePath)))} gzip`,
  )
}

console.log(lines.join('\n'))

assertBudget(
  'Entry JavaScript',
  entryJavascriptGzip,
  budgets.entryJavaScript.maxGzipBytes,
)
assertBudget('Entry CSS', entryCssGzip, budgets.entryCss.maxGzipBytes)
assertBudget(
  'Async JavaScript',
  asyncJavascriptGzip,
  budgets.asyncChunkJavaScript.maxGzipBytes,
)
assertBudget(
  'Total JavaScript',
  totalJavascriptGzip,
  budgets.totalJavaScript.maxGzipBytes,
)
