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
$cfg['Servers'][1]['password'] = (string) (getenv('VHOSTRA_PMA_PASSWORD') ?: '');
$cfg['Servers'][1]['AllowNoPassword'] = false;
$cfg['Servers'][1]['AllowRoot'] = false;
$cfg['Servers'][1]['compress'] = false;
