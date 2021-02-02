const fs = require('fs')
const path = require('path')
const {discoverPathSync} = require('discover-path')
const {default: traverse} = require('@babel/traverse')
const {parseSync} = require('@babel/core')

module.exports = {findDependencies}

const partReg = /^(all:part|part|config):/

function findDependenciesFromFiles(files, seen = new Set()) {
  const dependencies = new Set()
  files.forEach((file) => findDependencies(file, seen).forEach((dep) => dependencies.add(dep)))
  return Array.from(dependencies)
}

function findDependencies(entryPath, seen = new Set()) {
  if (Array.isArray(entryPath)) {
    return findDependenciesFromFiles(entryPath, seen)
  }

  seen.add(entryPath)

  let content
  try {
    content = fs.readFileSync(entryPath, 'utf8')
  } catch (err) {
    throw new Error(`Error reading file (${entryPath}): ${err.message}`)
  }

  let ast
  try {
    ast = parseSync(content, {babelrc: false})
  } catch (err) {
    throw new Error(`Error parsing file (${entryPath}): ${err.message}`)
  }

  const dir = path.dirname(entryPath)
  const dependencies = new Set()

  function processDependency(requirePath) {
    if (typeof requirePath !== 'string') {
      return
    }

    // Don't allow absolute requires
    if (path.isAbsolute(requirePath)) {
      throw new Error(
        `Absolute paths cannot be used in require/import statements: ${entryPath} references path "${requirePath}"`
      )
    }

    const isRelative = requirePath.startsWith('.')
    const depPath = isRelative && resolveDependency(dir, requirePath, entryPath)

    if (depPath && path.extname(depPath) === '.js' && !seen.has(depPath)) {
      // For relative javascript requires, recurse to find all depdendencies
      findDependencies(depPath, seen).forEach((dep) => dependencies.add(dep))
      return
    }

    if (isRelative) {
      // Not JS? Skip it
      return
    }

    // For parts, we want the entire path, as we might want to validate them
    if (partReg.test(requirePath)) {
      dependencies.add(requirePath)
      return
    }

    // For modules, resolve the base module name, then add them
    // eg: `codemirror/mode/javascript` => `codemirror`
    // eg: `@sanity/base/foo/bar.js`    => `@sanity/base`
    const dep = requirePath.startsWith('@')
      ? requirePath.replace(/^(@[^/]+\/[^/]+)(\/.*|$)/, '$1')
      : requirePath.replace(/^([^/]+)(\/.*|$)/, '$1')

    dependencies.add(dep)
  }

  traverse(ast, {
    ImportDeclaration({node}) {
      processDependency(node.source.value)
    },

    CallExpression({node}) {
      if (node.callee.name === 'require') {
        processDependency(node.arguments[0].value)
      }
    },
  })

  return Array.from(dependencies)
}

function resolveDependency(fromDir, toPath, entryPath) {
  let depPath
  try {
    depPath = require.resolve(path.resolve(fromDir, toPath))
  } catch (err) {
    throw new Error(`Unable to resolve "${toPath}" from ${entryPath}`)
  }

  let actualPath
  try {
    actualPath = discoverPathSync(depPath)
  } catch (err) {
    const paths = (err.suggestions || []).map((suggested) => getDidYouMeanPath(toPath, suggested))
    const didYouMean = paths ? `Did you mean:\n${paths.join('\n- ')}` : ''
    throw new Error(`Unable to resolve "${toPath}" from ${entryPath}. ${didYouMean}`)
  }

  if (actualPath !== depPath) {
    const didYouMean = getDidYouMeanPath(toPath, actualPath)
    throw new Error(`Unable to resolve "${toPath} from ${entryPath}. Did you mean "${didYouMean}"?`)
  }

  return actualPath
}

function getDidYouMeanPath(wanted, suggested) {
  const end = wanted.replace(/[./]+/, '')
  const start = wanted.slice(0, 0 - end.length)
  return `${start}${suggested.slice(0 - end.length)}`
}
