import apache from '../assets/services/apache.gif'
import mariadb from '../assets/services/mariadb.svg'
import memcached from '../assets/services/memcached.jpg'
import nginx from '../assets/services/nginx.svg'
import openlitespeed from '../assets/services/openlitespeed.png'
import php from '../assets/services/php.svg'
import phpmyadmin from '../assets/services/phpmyadmin.svg'
import redis from '../assets/services/redis.svg'

export const serviceBrandAssets = {
  OpenLiteSpeed: openlitespeed,
  Apache: apache,
  Nginx: nginx,
  PHP: php,
  MariaDB: mariadb,
  Redis: redis,
  Memcached: memcached,
  phpMyAdmin: phpmyadmin,
} as const

export type ServiceBrandName = keyof typeof serviceBrandAssets

/** The one local asset mapping used for service identity throughout the desktop UI. */
export function ServiceBrand({ name }: { name: ServiceBrandName }) {
  return <span className="service-brand"><img src={serviceBrandAssets[name]} alt={`${name} logo`} /></span>
}
