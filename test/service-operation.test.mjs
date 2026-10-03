import assert from 'node:assert/strict'
import test from 'node:test'
import { serviceOperationLabel } from '../src/serviceOperation.ts'

test('every supported Services subject retains the requested action wording across runtime observations', () => {
  const actions = { start: 'Starting', stop: 'Stopping', restart: 'Restarting', enable: 'Enabling', disable: 'Disabling' }
  for (const subject of ['web', 'mariadb', 'redis', 'memcached']) {
    for (const [action, expected] of Object.entries(actions)) {
      if ((action === 'enable' || action === 'disable') && !['redis', 'memcached'].includes(subject)) continue
      const operation = Object.freeze({ id: 1, subject, action })
      for (const state of ['running', 'stopped', 'starting', 'stopping', 'restarting', 'disabled']) {
        assert.equal(serviceOperationLabel(operation.action), expected, `${subject} ${action} during ${state}`)
        assert.equal(operation.action, action)
      }
    }
  }
})
