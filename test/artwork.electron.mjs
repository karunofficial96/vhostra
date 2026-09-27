import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1000, height: 680 });
    try {
        const source = await readFile('src/components/ServiceBrand.tsx', 'utf8');
        const names = { openlitespeed: 'OpenLiteSpeed', apache: 'Apache', nginx: 'Nginx', php: 'PHP', mariadb: 'MariaDB', redis: 'Redis', memcached: 'Memcached', phpmyadmin: 'phpMyAdmin' };
        const assets = [...source.matchAll(/import (\w+) from '([^']+)'/g)].map(([, key, asset]) => ({ name: names[key], url: pathToFileURL(path.resolve('src/components', asset)).href }));
        assert.equal(assets.length, 8);
        const css = (await readFile('src/styles.css', 'utf8')).replace('@import "tailwindcss";', '');
        const rows = assets.map(({ name, url }) => `<div class="row"><span class="service-brand${name === 'MariaDB' ? ' service-brand-mariadb' : ''}"><img src="${url}"></span><span>${name}</span></div>`).join('');
        const frame = (theme) => `<html data-theme="${theme}"><style>${css}body{padding:24px;font:14px Arial}h2{margin:0 0 18px}.row{display:flex;align-items:center;gap:16px;margin:18px 0}</style><h2>${theme} theme • actual service assets</h2>${rows}</html>`;
        const gallery = path.resolve('test/.artwork-gallery.html');
        const html = `<html><body style="margin:0">${['light', 'dark'].map(theme => `<iframe style="border:0;width:50%;height:640px" srcdoc="${frame(theme).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`).join('')}</body></html>`;
        await writeFile(gallery, html);
        await window.loadFile(gallery);
        await window.webContents.executeJavaScript(`Promise.all([...document.querySelectorAll('iframe')].map(f => new Promise(resolve => { const check=()=>Promise.all([...f.contentDocument.images].map(i=>i.decode())).then(resolve);if(f.contentDocument.readyState==='complete')check();else f.onload=check;})))`);
        const dimensions = await window.webContents.executeJavaScript(`[...document.querySelectorAll('iframe')].flatMap(f=>[...f.contentDocument.images].map(i=>({loaded:i.naturalWidth>0,width:i.getBoundingClientRect().width,height:i.getBoundingClientRect().height})))`);
        assert.equal(dimensions.length, 16);
        assert.ok(dimensions.every(i => i.loaded && i.width <= 30 && i.height <= 30));
        await writeFile('/private/tmp/vhostra-service-artwork.png', (await window.webContents.capturePage()).toPNG());
        console.log('All eight service marks loaded at compact bounds in both themes. Screenshot: /private/tmp/vhostra-service-artwork.png');
    } finally {
        const { rm } = await import('node:fs/promises');
        await rm('test/.artwork-gallery.html', { force: true });
        window.destroy(); app.quit();
    }
}).catch(error => { console.error(error); app.exit(1); });
