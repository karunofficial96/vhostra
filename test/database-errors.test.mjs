import test from 'node:test'
import assert from 'node:assert/strict'
import {parseError,mapDiagnosticPaths} from '../dist-electron/errors.js'
import {redactProgress} from '../dist-electron/progress.js'
test('known failures have simple titles, reliable locations and selectable diagnostic values',()=>{
 const mapped=mapDiagnosticPaths('nginx: [emerg] invalid number of arguments in "root" directive in /etc/vhostra/nginx/vhostra.conf:24',[['/etc/vhostra/nginx','/Users/fixture/Vhostra/runtime/nginx']]);const error=parseError(mapped)
 assert.match(error.title,/Nginx could not start/);assert.deepEqual(error.details.find(row=>row.label==='Line'),{label:'Line',value:'24'});assert.match(error.details.find(row=>row.label==='File').value,/Users\/fixture/);assert.equal(error.details.find(row=>row.label==='Cause').value,'Invalid directive arguments')
 assert.equal(mapDiagnosticPaths('/etc/vhostra/nginx-other/config.conf',[['/etc/vhostra/nginx','/host/nginx']]),'/etc/vhostra/nginx-other/config.conf')
 const php=parseError('PHP Fatal error: failure in /site/index.php on line 9');assert.equal(php.details.find(row=>row.label==='Line').value,'9')
 const apache=parseError('AH00526: Syntax error on line 12 of /host/apache.conf:');assert.equal(apache.details.find(row=>row.label==='File').value,'/host/apache.conf')
})
test('errors preserve unknown technical messages without inventing causes or locations',()=>{
 const unknown=parseError('unrecognized fixture failure at a service');assert.match(unknown.title,/could not complete/);assert.deepEqual(unknown.details,[{label:'Technical message',value:'unrecognized fixture failure at a service'}])
 for(const service of ['Redis','Memcached','OpenLiteSpeed','Docker'])assert.equal(parseError(`${service} failed`).details.find(row=>row.label==='Service').value,service)
 const database=parseError('Vhostra could not connect to the database. MariaDB rejected the username, password, host, or permissions (error 1045). Database user: fixture; Requested host: localhost; Database: wp_fixture.')
 assert.equal(database.details.find(row=>row.label==='Requested host').value,'localhost');assert.equal(database.details.find(row=>row.label==='Database').value,'wp_fixture');assert.equal(database.details.some(row=>row.label==='Line'),false)
})
test('central redaction covers request secrets, WordPress source and account authentication metadata',()=>{
 const secret="copied-fixture-password";const input=`password=${secret}\nDB_PASSWORD='config-secret'\nauthentication_string=*AB1234\ndefine('DB_PASSWORD', 'wp-secret');\ndefine('AUTH_SALT','private-salt');\nAuthorization: Bearer private-token\nmysql://user:${secret}@localhost\nIDENTIFIED VIA mysql_native_password USING '*PRIVATEHASH'`;
 const safe=redactProgress(input,[secret]);assert.doesNotMatch(safe,/copied-fixture-password|config-secret|AB1234|wp-secret|private-salt|private-token|PRIVATEHASH/);assert.doesNotMatch(JSON.stringify(parseError(input)),/wp-secret|private-salt|private-token|PRIVATEHASH/)
})
test('redaction handles escaped quoted assignments and non-HTTP credential URLs',()=>{
 const input=String.raw`DB_PASSWORD='quoted\'password still secret'; PRIVATE_KEY="key\" still secret"; mysql://user:private-uri-password@localhost`;
 const safe=redactProgress(input);assert.doesNotMatch(safe,/password still secret|still secret|private-uri-password/)
})
