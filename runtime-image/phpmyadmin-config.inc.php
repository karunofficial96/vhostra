<?php
declare(strict_types=1);

/* Vhostra keeps phpMyAdmin in its single supervised runtime. Credentials are
 * entered using phpMyAdmin's cookie authentication and never exposed to the
 * Electron renderer. */
$cfg['blowfish_secret'] = (string) (getenv('VHOSTRA_PMA_BLOWFISH_SECRET') ?: '');
$cfg['Servers'][1]['host'] = '127.0.0.1';
$cfg['Servers'][1]['port'] = 3306;
$cfg['Servers'][1]['auth_type'] = 'cookie';
$cfg['Servers'][1]['AllowNoPassword'] = false;
$cfg['Servers'][1]['compress'] = false;
