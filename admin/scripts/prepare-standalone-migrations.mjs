import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const adminRoot = path.resolve(scriptDir, '..')
const targetRoot = path.resolve(process.argv[2] || path.join(adminRoot, '.next', 'standalone'))
const sourceDir = path.join(adminRoot, 'src', 'migrations')
const targetDir = path.join(targetRoot, 'migrations')
const runnerSource = path.join(scriptDir, 'migrate.mjs')
const runnerTarget = path.join(targetRoot, 'migrate.mjs')

if (!fs.existsSync(path.join(targetRoot, 'server.js'))) {
  throw new Error(`standalone server.js not found: ${targetRoot}`)
}
if (!fs.existsSync(sourceDir)) {
  throw new Error(`migration source directory not found: ${sourceDir}`)
}
if (!fs.existsSync(runnerSource)) {
  throw new Error(`migration runner not found: ${runnerSource}`)
}

fs.mkdirSync(targetDir, { recursive: true })

const migrationFiles = fs
  .readdirSync(sourceDir)
  .filter((file) => file.endsWith('.ts') && file !== 'index.ts')
  .sort()

for (const file of migrationFiles) {
  const sourcePath = path.join(sourceDir, file)
  const outputPath = path.join(targetDir, file.replace(/\.ts$/, '.js'))
  const source = fs.readFileSync(sourcePath, 'utf8')
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      isolatedModules: true,
    },
    fileName: sourcePath,
    reportDiagnostics: true,
  })

  const errors = (result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  if (errors.length > 0) {
    const formatted = ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => adminRoot,
      getNewLine: () => '\n',
    })
    throw new Error(`failed to transpile migration ${file}:\n${formatted}`)
  }

  fs.writeFileSync(outputPath, result.outputText, 'utf8')
  console.log(`[admin-migrations] ${file} -> ${path.relative(adminRoot, outputPath)}`)
}

fs.copyFileSync(runnerSource, runnerTarget)
console.log(`[admin-migrations] runner -> ${path.relative(adminRoot, runnerTarget)}`)
