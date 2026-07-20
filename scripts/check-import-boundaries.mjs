import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import ts from 'typescript'

const root = process.argv[2] ?? 'src'
const forbiddenPackages = /^(?:node:|react(?:\/|$)|@nktkas\/|hyperliquid(?:\/|$))/

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else if (entry.isFile() && path.endsWith('.ts')) files.push(path)
  }
  return files
}

function importSpecifiers(source, file) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const specifiers = []

  function addLiteral(node, kind) {
    if (!node || !ts.isStringLiteralLike(node)) {
      throw new Error(`${file} uses a non-literal ${kind}`)
    }
    specifiers.push(node.text)
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) addLiteral(node.moduleSpecifier, 'module specifier')
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      addLiteral(node.arguments[0], 'dynamic import')
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      addLiteral(node.arguments[0], 'require call')
    } else if (ts.isImportTypeNode(node)) {
      if (!ts.isLiteralTypeNode(node.argument)) {
        throw new Error(`${file} uses a non-literal import type`)
      }
      addLiteral(node.argument.literal, 'import type')
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addLiteral(node.moduleReference.expression, 'import-equals declaration')
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

for (const file of await walk(root)) {
  const source = await readFile(file, 'utf8')
  const imports = importSpecifiers(source, file)
  const relativeFile = relative(root, file).replaceAll('\\', '/')
  for (const specifier of imports) {
    if (forbiddenPackages.test(specifier)) {
      throw new Error(`${file} imports forbidden runtime surface ${specifier}`)
    }
    if (specifier === 'decimal.js' && relativeFile !== 'core/decimal.ts') {
      throw new Error(`${file} bypasses the single Decimal kernel`)
    }
    if (
      relativeFile.startsWith('core/') &&
      specifier.startsWith('../') &&
      !specifier.startsWith('../model/')
    ) {
      throw new Error(`${file} imports a domain from core through ${specifier}`)
    }
  }
}

console.log(`Checked import boundaries under ${relative('.', root)}`)
