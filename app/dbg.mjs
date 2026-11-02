import AdmZip from './node_modules/adm-zip/adm-zip.js'
const files = process.argv.slice(2)
for (const f of files) {
  try {
    const z = new AdmZip(f)
    const names = z.getEntries().map(e => e.entryName).filter(n => /mods\.toml|fabric\.mod\.json|neoforge\.mods\.toml/i.test(n))
    console.log('===', f.split('\\').pop(), '| meta:', names.join(', ') || '(无)')
    for (const n of names.slice(0,1)) {
      const txt = z.getEntry(n).getData().toString('utf8').slice(0, 700)
      console.log(txt.split('\n').filter(l => /modId|\[\[|^\s*modLoader|versionRange/.test(l)).slice(0,8).join('\n'))
    }
  } catch (e) { console.log('ERR', f, e.message) }
}
