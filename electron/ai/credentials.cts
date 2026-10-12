import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { apiKeySchema } from '../../shared/contracts.cjs'
import { AppError } from './errors.cjs'
export interface SecretEncryption {
  available(): Promise<boolean>
  encrypt(value: string): Promise<Buffer>
  decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt?: boolean }>
}
/** Main-only credential vault. Status and IPC never return the decrypted credential. */
export class CredentialStore {
  private key = ''
  private saved = false
  private available = false
  private warning: string | null = null
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private filename: string, private encryption: SecretEncryption) {}
  getKey() { return this.key }
  status() { return { keyStorageAvailable: this.available, keySaved: this.saved, keyWarning: this.warning } }
  async load() {
    this.key = ''; this.warning = null
    try { this.available = await this.encryption.available() } catch { this.available = false }
    if (!this.available) this.warning = 'Secure OS storage is unavailable. Unlock your keychain or credential store and restart the app.'
    let bytes: Buffer
    try { bytes = await readFile(this.filename); this.saved = true }
    catch (error) { this.saved = (error as NodeJS.ErrnoException).code !== 'ENOENT'; if (this.saved) this.warning = 'The saved API key could not be read. Replace or remove it in Settings.'; return }
    if (!this.available) { this.warning = 'Secure OS storage is unavailable. Unlock your keychain or credential store and restart the app.'; return }
    try {
      if (!bytes.length || bytes.length > 8192) throw new Error()
      const decoded = await this.encryption.decrypt(bytes)
      const parsed = apiKeySchema.safeParse(decoded.result)
      if (!parsed.success) throw new Error()
      this.key = parsed.data
      if (decoded.shouldReEncrypt) await this.persist(this.key)
    } catch { this.key = ''; this.warning = 'The saved API key could not be unlocked. Replace or remove it in Settings.' }
  }
  private async persist(key: string) {
    if (!await this.encryption.available()) throw new AppError('SECURE_STORAGE_UNAVAILABLE', 'Secure OS storage is unavailable. Unlock your keychain or credential store before saving a key.')
    const bytes = await this.encryption.encrypt(key)
    const temporary = `${this.filename}.${randomUUID()}.tmp`
    try { await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 }); await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' }); await rename(temporary, this.filename) }
    finally { await unlink(temporary).catch(() => {}) }
  }
  private serial<T>(work: () => Promise<T>) { const task = this.queue.then(work); this.queue = task.catch(() => {}); return task }
  set(value: string) { return this.serial(async () => {
    const parsed = apiKeySchema.safeParse(value)
    if (!parsed.success) throw new AppError('VALIDATION', 'Enter a valid OpenAI API key beginning with sk-.')
    try { await this.persist(parsed.data) }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError('CREDENTIAL_SAVE_FAILED', 'The API key could not be saved securely. Your previous key was kept.') }
    this.key = parsed.data; this.saved = true; this.available = true; this.warning = null
  }) }
  remove() { return this.serial(async () => {
    try { await unlink(this.filename) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AppError('CREDENTIAL_REMOVE_FAILED', 'The API key could not be removed. Please try again.') }
    this.key = ''; this.saved = false; this.warning = null
  }) }
}
