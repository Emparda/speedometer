// Resolve the CLI's bundled private module explicitly for local npm installs.
const path = require('node:path')
const { createRequire } = require('node:module')
const cliPackage = require.resolve('@zeppos/zeus-cli/package.json')
const cliRoot = path.dirname(cliPackage)
const cliRequire = createRequire(cliPackage)
cliRequire('module-alias').addAlias('zeppos-app-utils', path.join(cliRoot, 'private-modules/zeppos-app-utils'))
const entry = path.join(cliRoot, 'bin/main.js')
process.argv[1] = entry
require(entry)
