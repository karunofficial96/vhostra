/** Transient user intent for the Services control; runtime observations never redefine it. */
export type ServiceAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable'
export type ServiceOperation = Readonly<{ id: number; subject: 'web' | 'mariadb' | 'redis' | 'memcached'; action: ServiceAction }>

export const serviceOperationLabel = (action: ServiceAction): string => ({
  start: 'Starting', stop: 'Stopping', restart: 'Restarting', enable: 'Enabling', disable: 'Disabling',
})[action]
