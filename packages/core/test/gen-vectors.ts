// `bun run vectors`: writes PROTOCOL-SPEC §15 golden vectors.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { VECTORS, toJson } from './vectors'

const dir = join(import.meta.dir, 'vectors')
mkdirSync(dir, { recursive: true })
for (const [name, build] of Object.entries(VECTORS)) {
  writeFileSync(join(dir, `${name}.json`), toJson(build()))
  console.log(`wrote vectors/${name}.json`)
}
