const path = require('path')
const childProcess = require('child_process')
const npmRunPath = require('npm-run-path')
const findBabelConfig = require('find-babel-config')
const log = require('../util/log')
const {getPaths} = require('../sanity/manifest')
const {getPackage} = require('../npm/package')
const {buildExtensions} = require('../configs/buildExtensions')

const defaultBabelConfigPath = path.join(__dirname, '..', 'configs', 'babelrc.js')
const noUndefined = (arr) => arr.filter((item) => typeof item !== 'undefined')

module.exports = async function build({basePath, flags}) {
  const pkg = await getPackage({basePath, flags})
  const paths = await getPaths({basePath, pluginName: pkg.name, flags, verifySourceParts: true})
  if (!paths) {
    log.warn(`No "paths" property declared in sanity.json, will not compile with babel`)
    return
  }

  const babelConfig = await findBabelConfig(basePath)
  const configPath = babelConfig.file || defaultBabelConfigPath

  log.info('Compiling plugin:')
  log.info('Input : %s', paths.source)
  log.info('Output: %s', paths.compiled)
  log.info('👀 Watching for changes')

  await spawn(
    'babel',
    noUndefined([
      // Booleans
      '--copy-files',
      '--delete-dir-on-start',
      flags.watch ? '--watch' : undefined,
      flags.silent ? '--quiet' : undefined,
      flags.verbose ? '--verbose' : undefined,

      // Babel configuration
      '--config-file',
      configPath,

      // Compile JSX, typescript as well
      '--extensions',
      buildExtensions.join(','),

      // Use source maps?
      '--source-maps',
      flags.sourceMaps || 'true',

      // Where to actually output the stuff
      '--out-dir',
      paths.compiled,

      // Where to read source from
      paths.source,
    ]),
    {
      env: npmRunPath.env(),
      stdio: 'inherit',
    }
  )
}

function spawn(cmd, args, options) {
  // ref: https://stackoverflow.com/questions/37459717/error-spawn-enoent-on-windows/37487465
  const withShellOptions = process.platform === 'win32' ? {...options, ...{shell: true}} : options

  return new Promise((resolve, reject) => {
    childProcess.spawn(cmd, args, withShellOptions).on('error', reject).on('close', resolve)
  })
}
