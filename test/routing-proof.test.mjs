import test from 'node:test'
import assert from 'node:assert/strict'
import { legacyOlsRouteMatches } from '../dist-electron/routing-proof.js'
const host={id:'owned-id',hostname:'example.test',aliases:['www.example.test']}
const config='docRoot /var/www/vhostra/owned-id/\ncontext / {\nallowBrowse 1\nlocation $DOC_ROOT/\n}\n'
const expected=config.replace('location $DOC_ROOT/','location $DOC_ROOT/\nextraHeaders set X-Vhostra-Site owned-id')
const main=`virtualHost owned-id{\nconfigFile /usr/local/lsws/conf/vhostra-sites/owned-id.conf\n}\nlistener Default{\naddress *:8088\nsecure 0\nmap Example *\nmap owned-id example.test\nmap owned-id www.example.test\n}\nlistener TLS{\naddress *:8443\nsecure 1\nmap Example *\nmap owned-id example.test\n}`
test('legacy routing proof requires exact active definition, root, listener, port, scheme and hostname',()=>{
 for(const url of ['http://example.test/','http://www.example.test/','https://example.test/'])assert.ok(legacyOlsRouteMatches(main,config,expected,host,new URL(url)))
 for(const native of [main.replace('map owned-id example.test','map Example example.test'),main.replace('address *:8088','address *:9999'),main.replace('secure 0','secure 1'),main+'\nvirtualHost owned-id{\nconfigFile /foreign\n}',main.replace('map owned-id example.test','map owned-id other.test')])assert.equal(legacyOlsRouteMatches(native,config,expected,host,new URL('http://example.test/')),false)
 assert.equal(legacyOlsRouteMatches(main,config.replace('owned-id/','foreign/'),expected,host,new URL('http://example.test/')),false)
 assert.equal(legacyOlsRouteMatches(main,config,expected,host,new URL('http://unknown.test/')),false)
})
