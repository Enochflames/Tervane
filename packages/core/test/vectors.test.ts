import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { VECTORS, toJson } from './vectors'

for (const [name, build] of Object.entries(VECTORS)) {
  test(`vectors/${name}.json matches the TS implementation`, () => {
    const file = readFileSync(join(import.meta.dir, 'vectors', `${name}.json`), 'utf8')
    expect(file).toBe(toJson(build()))
  })
}
