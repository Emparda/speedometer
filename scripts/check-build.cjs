const fs = require('node:fs')
const path = require('node:path')
function walk(p) {
  if (!fs.existsSync(p)) return []
  return fs.readdirSync(p, { withFileTypes: true }).flatMap(e => {
    const f = path.join(p, e.name)
    return e.isDirectory() ? walk(f) : [f]
  })
}
const packages = walk('dist').filter(p => p.endsWith('.zab') && fs.statSync(p).size > 0)
if (!packages.length) { console.error('Build failed: no .zab package in dist/'); process.exit(1) }
console.log('Package:', packages.join(', '))
