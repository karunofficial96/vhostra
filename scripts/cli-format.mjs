/** Small, local formatter for the human-facing command line. */
const title = value => String(value ?? '').replace(/(^|[-_\s])\w/g, match => match.toUpperCase())
const safe = value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
const labels = { 'not-created': 'Not Created', unavailable: 'Unavailable', unhealthy: 'Unhealthy', error: 'Failed' }
export const stateLabel = value => labels[value] ?? title(value)
export function prerequisiteMessage(service, state, startCommand) {
  const label = stateLabel(state || 'unavailable')
  const next = state === 'not-created' ? `Create and start it with ${startCommand}.`
    : state === 'stopped' ? `Start it with ${startCommand}.`
    : ['starting', 'stopping', 'restarting'].includes(state) ? 'Wait for the current service operation to finish.'
    : state === 'disabled' ? `Enable ${service} before using this command.`
    : `Check Docker and the ${service} service in Vhostra.`
  return `${service} is ${label}. ${next}`
}
export function formatStatus(runtime, services) {
  return ['Vhostra Runtime', `Status: ${stateLabel(runtime.state)}`, '', 'Services', ...services.map(row => `${row.label.padEnd(20)} Configured: ${row.enabled ? 'Enabled' : 'Disabled'} · Status: ${stateLabel(row.state)}`)].join('\n')
}
export function formatResult(value, context = '') {
  if (value === null || value === undefined) return 'Done.'
  if (safe(value)) return String(value)
  if (Array.isArray(value)) {
    if (!value.length) return 'None found.'
    return value.map(item => {
      if (safe(item)) return String(item)
      if (item.label && item.state) return `${item.label}: Configured: ${item.enabled ? 'Enabled' : 'Disabled'} · Status: ${stateLabel(item.state)}`
      if (item.hostname) return [item.hostname, item.aliases?.length ? `Aliases: ${item.aliases.join(', ')}` : '', item.documentRoot ? `Root: ${item.documentRoot}` : '', item.state ? `Status: ${stateLabel(item.state)}` : ''].filter(Boolean).join('  ·  ')
      if (item.name || item.url) return [item.name || item.hostname, item.url || '', item.documentRoot || ''].filter(Boolean).join('  ·  ')
      if (item.id && item.status) return `${item.id}: ${stateLabel(item.status)}`
      return Object.entries(item).filter(([key, field]) => ['id', 'label', 'state', 'enabled', 'address', 'path'].includes(key) && safe(field)).map(([key, field]) => `${title(key)}: ${key === 'state' ? stateLabel(field) : field}`).join('  ·  ') || 'Completed.'
    }).join('\n')
  }
  if (value.runtime && value.services) return formatStatus(value.runtime, value.services)
  if (value.label && value.state) return `${value.label}: Configured: ${value.enabled ? 'Enabled' : 'Disabled'} · Status: ${stateLabel(value.state)}`
  if (value.state) return `Status: ${stateLabel(value.state)}`
  if (value.sites && Array.isArray(value.sites)) return `Site saved.\n${formatResult(value.sites)}${value.mapping?.message ? `\nHosts: ${value.mapping.message}` : ''}`
  if (value.message && typeof value.message === 'string') return value.message
  if (value.status && typeof value.status === 'string') return [`Status: ${stateLabel(value.status)}`, ...(Array.isArray(value.hosts) ? value.hosts.map(host => `Site: ${host.hostname}${host.aliases?.length ? ` (${host.aliases.join(', ')})` : ''}`) : []), ...(Array.isArray(value.warnings) && value.warnings.length ? [`Warnings: ${value.warnings.length}`] : [])].join('\n')
  if (value.mapping?.message) return `Site configuration saved.\nHosts: ${value.mapping.message}`
  const visible = Object.entries(value).filter(([key, field]) => ['database', 'name', 'hostname', 'url', 'documentRoot', 'path', 'selected', 'supported', 'enabled', 'version', 'conflicts', 'warnings'].includes(key) && (safe(field) || Array.isArray(field) && field.every(safe)))
  if (visible.length) return visible.map(([key, field]) => `${title(key)}: ${Array.isArray(field) ? field.join(', ') : field}`).join('\n')
  return `${title(context.replace(/\s+/g, ' ')) || 'Operation'} completed.`
}
