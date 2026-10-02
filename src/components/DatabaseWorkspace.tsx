import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ServiceBrand } from './ServiceBrand'
import { ErrorNotice } from './ErrorNotice'
import { PasswordField } from './PasswordField'
import { useCompletionScroll } from './useCompletionScroll'
type Account = Awaited<ReturnType<NonNullable<Window['vhostra']>['listDatabaseUsers']>>[number]
export function DatabaseWorkspace({ running, applicationRunning, port }: { running: boolean; applicationRunning: boolean; port: number }) {
  const [databases, setDatabases] = useState<string[]>([])
  const [users, setUsers] = useState<Account[]>([])
  const [name, setName] = useState('')
  const [charset, setCharset] = useState('utf8mb4')
  const [selected, setSelected] = useState('custom')
  const [username, setUsername] = useState('')
  const [host, setHost] = useState('localhost')
  const [password, setPassword] = useState('')
  const [resetPassword, setResetPassword] = useState(false)
  const [accessDatabase, setAccessDatabase] = useState<string | null>(null)
  const [exportDatabaseName, setExportDatabaseName] = useState('')
  const [productionUrl, setProductionUrl] = useState('')
  const [productionRoot, setProductionRoot] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [newUsername, setNewUsername] = useState('')
  const [newHost, setNewHost] = useState('localhost')
  const [userPassword, setUserPassword] = useState('')
  const [editingUser, setEditingUser] = useState<Account | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const resultRef = useRef<HTMLDivElement>(null)
  const [completion, setCompletion] = useState(0)
  useCompletionScroll(resultRef, completion)
  const passwordDialog = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (!editingUser) return
    const previous = document.activeElement as HTMLElement | null
    passwordDialog.current?.querySelector<HTMLButtonElement>('button[data-cancel]')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { setEditingUser(null); setNewPassword(''); setConfirmPassword('') }
      if (event.key !== 'Tab') return
      const controls = [...(passwordDialog.current?.querySelectorAll<HTMLElement>('input,button:not(:disabled)') ?? [])]
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [editingUser, busy])
  const key = (user: Account) => JSON.stringify([user.username, user.host])
  const account = users.find(user => key(user) === selected)
  const duplicate = !account && /database user already exists/i.test(String(error)) ? users.find(user => user.username === username && user.host === host.toLowerCase()) : undefined
  const refreshUsers = async () => setUsers(await window.vhostra!.listDatabaseUsers())
  const refresh = async () => {
    const [databaseRows, accountRows] = await Promise.all([window.vhostra!.listDatabases(), window.vhostra!.listDatabaseUsers()])
    setDatabases(databaseRows); setUsers(accountRows)
    setExportDatabaseName(current => databaseRows.includes(current) ? current : '')
  }
  useEffect(() => { if (running) void refresh().catch(setError); else { setDatabases([]); setUsers([]) } }, [running])
  useEffect(() => { if (!success) return; const timer = setTimeout(() => setSuccess(null), 6000); return () => clearTimeout(timer) }, [success])
  const perform = async (operation: () => Promise<unknown>, message: string, inventory: 'all' | 'users' | 'none' = 'all') => {
    setBusy(true); setError(null); setSuccess(null)
    try { const result = await operation(); if (result === null) return; if (inventory === 'all') await refresh(); else if (inventory === 'users') await refreshUsers(); setSuccess(message); setCompletion(value => value + 1) }
    catch (reason) { if (inventory === 'all') await refresh().catch(() => {}); else if (inventory === 'users') await refreshUsers().catch(() => {}); setError(reason); setCompletion(value => value + 1) }
    finally { setBusy(false); setPassword('') }
  }
  const credentials = () => ({ username: account?.username ?? username, host: account?.host ?? host, password })
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await perform(async () => {
      if (accessDatabase) await window.vhostra!.updateDatabaseAccess({ ...credentials(), database: accessDatabase, resetPassword })
      else await window.vhostra!.createDatabase({ ...credentials(), name, charset, existingUser: Boolean(account) })
      setName(''); setResetPassword(false)
    }, accessDatabase ? 'Database access updated successfully.' : 'Database created successfully.', accessDatabase ? 'users' : 'all')
  }
  const inputClass = 'input mt-2'
  const actionClass = 'h-9 rounded-full border border-[#E5E5E5] px-4 text-sm font-medium disabled:opacity-50'
  return <div className="mx-auto max-w-[900px] px-6 py-6 lg:px-8">
    <ServiceBrand name="MariaDB"/><h1 className="mt-4 text-2xl font-bold">MariaDB</h1>
    <p className="mt-2 text-sm leading-5 text-[#606060]">PHP applications connect using <span className="selectable font-mono">localhost:3306</span>. Host database tools connect using <span className="selectable font-mono">127.0.0.1:{port}</span>.</p>
    <div ref={resultRef} id="database-result">{error != null && <ErrorNotice error={error} onDismiss={() => setError(null)}/>}
    {duplicate && <button type="button" disabled={busy} onClick={() => { setSelected(key(duplicate)); setPassword(''); setError(null) }} className={actionClass}>Select Existing User</button>}
    {success && <div role="status" className="mt-4 flex items-start justify-between gap-4 rounded-lg bg-[#F2F2F2] p-4 text-sm"><p className="selectable text-[#2BA640]">{success}</p><button onClick={() => setSuccess(null)} className="text-[#065FD4]">Dismiss</button></div>}</div>
    {running ? <>
      {!applicationRunning && <p className="mt-4 text-sm text-[#606060]">Start the web runtime to create databases and verify access through PHP localhost.</p>}
      <form onSubmit={event => void submit(event)} className="mt-6 grid gap-4 rounded-lg border border-[#E5E5E5] p-4 md:grid-cols-2">
        <fieldset disabled={busy} className="contents">
        <h2 className="text-xl font-medium md:col-span-2">{accessDatabase ? 'Database Access' : 'Database'}</h2>
        {accessDatabase ? <p className="selectable font-mono text-sm md:col-span-2">{accessDatabase}</p> : <>
          <label className="text-sm font-medium">Database Name<input required aria-label="Database Name" value={name} onChange={event => setName(event.target.value)} className={inputClass}/></label>
          <label className="text-sm font-medium">Character Set<select value={charset} onChange={event => setCharset(event.target.value)} className={inputClass}><option>utf8mb4</option><option>utf8</option><option>latin1</option></select></label>
        </>}
        <label className="mt-2 text-sm font-medium md:col-span-2">Database User<select aria-label="Database User" value={selected} onChange={event => { setSelected(event.target.value); setPassword(''); setResetPassword(false) }} className={inputClass}>
          {users.map(user => <option key={key(user)} value={key(user)}>{user.username} @ {user.host}</option>)}<option value="custom">Custom…</option>
        </select></label>
        {!account && <>
          <label className="text-sm font-medium">Username<input aria-label="Username" required value={username} onChange={event => setUsername(event.target.value)} className={inputClass}/></label>
          <label className="text-sm font-medium">Host<input aria-label="Host" required value={host} onChange={event => setHost(event.target.value)} className={inputClass}/></label>
          <p className="text-xs leading-5 text-[#606060] md:col-span-2">Host determines where this database user is allowed to connect from. Vhostra’s localhost gateway connects as localhost. Other hosts remain separate accounts and may not match this connection.</p>
        </>}
        {account && <p className="text-xs leading-5 text-[#606060] md:col-span-2">Enter this account’s password to verify access. Vhostra cannot display its existing password. Existing grants and passwords are preserved unless you choose to change the password.</p>}
        <PasswordField className="md:col-span-2" label={resetPassword ? 'New Password' : account ? 'Password to Verify Access' : 'Password'} ariaLabel="Database Password" autoComplete={account && !resetPassword ? 'current-password' : 'new-password'} minLength={!account || resetPassword ? 12 : undefined} value={password} onChange={event => setPassword(event.target.value)}/>
        {!account && <button type="button" className={actionClass} onClick={() => { const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_'; setPassword(Array.from(crypto.getRandomValues(new Uint8Array(24)), value=>alphabet[value % alphabet.length]).join('')) }}>Generate Password</button>}
        {accessDatabase && account && <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={resetPassword} onChange={event => { setResetPassword(event.target.checked); setPassword('') }}/>Change this account’s password for all its databases</label>}
        <div className="flex flex-wrap justify-end gap-3 md:col-span-2">
          <button disabled={busy || !applicationRunning || !password} type="button" onClick={() => void perform(() => window.vhostra!.checkDatabaseAccess({ ...credentials(), database: accessDatabase ?? (name || undefined) }), 'Database access verified successfully.', 'none')} className={actionClass}>Check Database Access</button>
          {accessDatabase && <><button type="button" onClick={() => { setAccessDatabase(null); setResetPassword(false); setPassword('') }} className={actionClass}>Cancel</button></>}
          <button disabled={busy || !applicationRunning || Boolean(accessDatabase && !account)} className="h-9 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Working…' : accessDatabase ? 'Update Database Access' : 'Create Database'}</button>
        </div>
        </fieldset>
      </form>
      <div className="mt-6 flex items-center justify-between gap-4"><h2 className="text-xl font-medium">Databases</h2><button disabled={busy} onClick={() => void refresh().catch(setError)} className={actionClass}>Refresh</button></div>
      <div className="mt-4 divide-y divide-[#E5E5E5] border-y border-[#E5E5E5]">{databases.map(database => <div key={database} data-database={database} className="min-w-0 py-4"><p className="selectable min-w-0 break-all font-mono text-sm leading-5">{database}</p><div className="mt-4 flex flex-wrap items-center gap-3">
        <button disabled={busy} className={actionClass} onClick={() => void window.vhostra!.openPhpMyAdmin(database).catch(setError)}>Manage with phpMyAdmin</button>
        <button disabled={busy} className={actionClass} onClick={() => void perform(() => window.vhostra!.importDatabase(database), 'Database imported successfully.')}>Import</button>
        <button disabled={busy} className={actionClass} onClick={() => void perform(() => window.vhostra!.exportDatabase(database), 'Database exported successfully.', 'none')}>Export</button>
        <button disabled={busy} className={actionClass} onClick={() => void perform(() => window.vhostra!.repairDatabase(database), 'Database checked successfully.', 'none')}>Repair</button>
        <button disabled={busy} className={`${actionClass} text-[#FF0000]`} onClick={() => { if (window.confirm(`Delete database “${database}”? This permanently removes its tables and data. Database users are not removed.`)) void perform(() => window.vhostra!.deleteDatabase(database), 'Database deleted successfully.') }}>Delete</button>
      </div></div>)}{databases.length === 0 && <p className="py-8 text-center text-sm text-[#606060]">No databases yet. Create one above.</p>}</div>
      <form onSubmit={event => { event.preventDefault(); void perform(() => window.vhostra!.exportProductionDatabase(exportDatabaseName, productionUrl, productionRoot), 'Database exported successfully. Data was exported unchanged; update application-specific URLs and paths after deployment.', 'none') }} className="mt-6 rounded-lg border border-[#E5E5E5] p-4">
        <h2 className="text-xl font-medium">Export Database for Production</h2>
        <p className="mt-2 text-xs leading-5 text-[#606060]">Save a local SQL dump for deployment elsewhere. Database content is exported unchanged to protect serialized and application-specific data.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-xs font-medium">Database<select required value={exportDatabaseName} onChange={event => setExportDatabaseName(event.target.value)} className="input mt-2"><option value="">Choose database</option>{databases.map(database => <option key={database} value={database}>{database}</option>)}</select></label>
        <label className="text-xs font-medium">Production URL<input required type="url" value={productionUrl} onChange={event => setProductionUrl(event.target.value)} placeholder="https://example.com" className="input mt-2"/></label>
        <label className="text-xs font-medium md:col-span-2">Production Root Directory<input required value={productionRoot} onChange={event => setProductionRoot(event.target.value)} placeholder="/var/www/example.com" className="input mt-2"/><span className="mt-2 block text-xs font-normal leading-5 text-[#606060]">Expected root on the production server, not this computer’s Site directory. Vhostra does not rewrite application paths automatically.</span></label></div>
        <div className="mt-4 flex justify-end"><button disabled={busy || !exportDatabaseName} className="h-9 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Exporting…' : 'Export'}</button></div>
      </form>
      <h2 className="mt-6 text-xl font-medium">Database Users</h2>
      <form onSubmit={event => { event.preventDefault(); void perform(() => window.vhostra!.createDatabaseUser({ username: newUsername, host: newHost, password: userPassword }), `Database user ${newUsername}@${newHost.toLowerCase()} created successfully.`, 'users').finally(() => setUserPassword('')) }} className="mt-4 grid gap-4 rounded-lg border border-[#E5E5E5] p-4 md:grid-cols-2">
        <label className="text-sm font-medium">New Username<input required aria-label="New Database Username" value={newUsername} onChange={event => setNewUsername(event.target.value)} className={inputClass}/></label>
        <label className="text-sm font-medium">Host<input required aria-label="New Database User Host" value={newHost} onChange={event => setNewHost(event.target.value)} className={inputClass}/></label>
        <PasswordField className="md:col-span-2" label="New User Password" ariaLabel="New Database User Password" autoComplete="new-password" minLength={12} value={userPassword} onChange={event => setUserPassword(event.target.value)}/>
        <div className="flex justify-end md:col-span-2"><button disabled={busy || !running} className="h-9 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create User'}</button></div>
      </form><div className="mt-4 divide-y divide-[#E5E5E5] border-y border-[#E5E5E5]">{users.map(user => <article key={key(user)} className="py-4"><p className="selectable font-mono text-sm">{user.username} @ {user.host}</p><p className="mt-2 text-xs text-[#606060]">Database Access</p><p className="selectable mt-1 break-all text-xs leading-5">{user.access.length ? user.access.map(access => `${access.database}: ${access.privilege}`).join(' · ') : 'No direct database grants.'}</p>{user.globalPrivileges?.length > 0 && <p className="mt-2 text-xs">Global privileges: <span className="selectable">{user.globalPrivileges.join(', ')}</span></p>}{user.roles?.length > 0 && <p className="mt-2 text-xs">Roles: <span className="selectable">{user.roles.join(', ')}</span></p>}<div className="mt-4 flex flex-wrap gap-3"><button disabled={busy} className={actionClass} onClick={() => { setEditingUser(user); setNewPassword(''); setConfirmPassword('') }}>Change Password</button>{!user.globalPrivileges?.length && !user.roles?.length && <button disabled={busy} className={`${actionClass} text-[#FF0000]`} onClick={() => { const identity = `${user.username} @ ${user.host}`; const access = user.access.map(item => item.database).filter((name, index, all) => all.indexOf(name) === index); if (window.confirm(`Delete database user ${identity}? ${access.length ? `This removes access to ${access.join(', ')}.` : 'This account has no direct database grants.'} The account and its grants will be removed.`)) void perform(() => window.vhostra!.deleteDatabaseUser({ username: user.username, host: user.host }), 'Database user deleted successfully.', 'users') }}>Delete</button>}</div></article>)}{users.length === 0 && <p className="py-4 text-sm text-[#606060]">No application database users yet.</p>}</div>
      {editingUser && <div role="dialog" aria-modal="true" aria-label="Change database user password" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"><form ref={passwordDialog} onSubmit={event => { event.preventDefault(); if (newPassword !== confirmPassword) { setError(new Error('New passwords do not match.')); setEditingUser(null); setCompletion(value => value + 1); return } const user = editingUser; void perform(() => window.vhostra!.changeDatabaseUserPassword({ username: user.username, host: user.host, password: newPassword }), 'Database user password changed successfully.', 'users').finally(() => { setNewPassword(''); setConfirmPassword(''); setEditingUser(null) }) }} className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 text-[#0F0F0F]"><h2 className="text-xl font-medium">Change Password</h2><p className="selectable font-mono text-sm">{editingUser.username} @ {editingUser.host}</p><PasswordField label="New Password" value={newPassword} minLength={12} onChange={event => setNewPassword(event.target.value)}/><PasswordField label="Confirm New Password" value={confirmPassword} minLength={12} onChange={event => setConfirmPassword(event.target.value)}/><div className="flex justify-end gap-3"><button type="button" data-cancel className={actionClass} onClick={() => { setEditingUser(null); setNewPassword(''); setConfirmPassword('') }}>Cancel</button><button type="submit" disabled={busy} className="h-9 rounded-full bg-[#FF0000] px-4 text-sm font-medium text-white disabled:opacity-50">Change Password</button></div></form></div>}
    </> : <p className="mt-6 rounded-lg bg-[#F2F2F2] p-4 text-sm text-[#606060]">Start MariaDB in Services to create and list persistent databases.</p>}
  </div>
}
