<?php
declare(strict_types=1);

/* Vhostra provisions this dedicated local account over MariaDB's Unix socket.
 * Its secret remains inside the Vhostra-owned Docker environment file and this
 * container: it is never exposed to the renderer, URL, welcome page or logs. */
$cfg['blowfish_secret'] = (string) (getenv('VHOSTRA_PMA_BLOWFISH_SECRET') ?: '');
$cfg['Servers'][1]['host'] = '127.0.0.1';
$cfg['Servers'][1]['port'] = 3306;
$cfg['Servers'][1]['auth_type'] = 'config';
$cfg['Servers'][1]['user'] = 'vhostra_pma';
/* Replaced by the entrypoint from VHOSTRA_PMA_PASSWORD before this server-side
 * PHP configuration is copied to the served phpMyAdmin application. */
$cfg['Servers'][1]['password'] = '__VHOSTRA_PMA_PASSWORD__';
$cfg['Servers'][1]['AllowNoPassword'] = false;
$cfg['Servers'][1]['AllowRoot'] = false;
$cfg['Servers'][1]['compress'] = false;
