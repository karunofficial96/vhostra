import type { VirtualHost } from './store.js'
/** Strictly recognize the generated OLS dialect; ambiguous/custom config fails closed. */
export function legacyOlsRouteMatches(main: string, config: string, expected: string, host: VirtualHost, target: URL) {
  const clean = (text: string) => text.replace(/#[^\n]*/g, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n')
  const withoutIdentity = (text: string) => clean(text).replace(/^extraHeaders set X-Vhostra-Site [^\n]+\n/gm, '')
  if (withoutIdentity(config) !== withoutIdentity(expected)) return false
  const nativeId = host.builtIn ? 'Example' : host.id
  const declarations = [...clean(main).matchAll(/virtualHost\s+(\S+)\s*\{([^{}]*)\}/g)].filter(match => match[1] === nativeId)
  const file = host.builtIn ? 'conf/vhosts/Example/vhconf.conf' : `/usr/local/lsws/conf/vhostra-sites/${host.id}.conf`
  if (declarations.length !== 1 || !declarations[0][2].split('\n').some(line => line.trim().split(/\s+/).join(' ') === `configFile ${file}`)) return false
  const port = target.protocol === 'https:' ? 8443 : 8088
  const listeners = [...clean(main).matchAll(/listener\s+[^{}]+\{([^{}]*)\}/g)].filter(match => new RegExp(`^address +\\*:${port}$`, 'm').test(match[1]))
  if (listeners.length !== 1 || !new RegExp(`^secure +${target.protocol === 'https:' ? 1 : 0}$`, 'm').test(listeners[0][1])) return false
  const routes = [...listeners[0][1].matchAll(/^map\s+(\S+)\s+(\S+)$/gm)]
  const exact = routes.filter(match => match[2].split(',').includes(target.hostname))
  if (exact.length) return exact.length === 1 && exact[0][1] === nativeId
  // Only localhost may use the protected default. Named hosts always need an exact map.
  return Boolean(host.builtIn && target.hostname === 'localhost' && routes.filter(match => match[2] === '*').length === 1 && routes.some(match => match[1] === 'Example' && match[2] === '*'))
}
