import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'

// Every direct mutation in these two files is inventoried while the machine
// runtime gate remains closed. This catches new call sites even when they use
// an existing method, and does not rely on line numbers that move during edits.
const inventory = JSON.parse(await readFile(new URL('./runtime-write-audit.json', import.meta.url), 'utf8'))
const mutators = new Set(['appendFile', 'chmod', 'chown', 'copyFile', 'cp', 'mkdir', 'open', 'rename', 'rm', 'rmdir', 'symlink', 'truncate', 'unlink', 'writeFile'])

async function callSites(file) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const found = []
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(tree) === 'fs' && mutators.has(node.expression.name.text)) {
      const expression = node.getText(tree).replace(/\s+/g, ' ')
      found.push(createHash('sha256').update(expression).digest('hex'))
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return found.sort()
}

test('runtime filesystem mutation inventory does not gain an unaudited direct call', async () => {
  for (const [file, approved] of Object.entries(inventory)) {
    const actual = await callSites(file)
    assert.deepEqual(actual, approved, `${file} direct filesystem calls changed; classify each change in docs/storage-audit.md and update this reviewed inventory`)
  }
})
