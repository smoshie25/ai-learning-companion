const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { tmpdir } = require('node:os')
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto')
const { CredentialStore } = require('../dist-electron/electron/ai/credentials.cjs')
const { saveKeySchema } = require('../dist-electron/shared/contracts.cjs')
const { validatePayload } = require('../dist-electron/electron/ipc/validation.cjs')
const key = 'sk-test-only-private-credential'
function encryption() {
 const secret = randomBytes(32)
 return {
 available: async () => true,
 encrypt: async value => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', secret, iv); return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]) },
 decrypt: async bytes => { const cipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0,12)); cipher.setAuthTag(bytes.subarray(-16)); return { result: Buffer.concat([cipher.update(bytes.subarray(12,-16)), cipher.final()]).toString() } }
 }
}
test('vault encrypts, restores, replaces and removes credentials without public disclosure', async () => {
 const dir = await fs.mkdtemp(path.join(tmpdir(), 'alc-vault-')); const file = path.join(dir, 'key.enc'); const crypto = encryption()
 try {
 const store = new CredentialStore(file, crypto); await store.load(); await store.set(key)
 assert.equal((await fs.readFile(file)).includes(Buffer.from(key)), false)
 assert.equal(JSON.stringify(store.status()).includes(key), false)
 const restored = new CredentialStore(file, crypto); await restored.load(); assert.equal(restored.getKey(), key)
 await restored.set(key + '-replacement'); await store.load(); assert.equal(store.getKey(), key + '-replacement')
 await restored.remove(); await store.load(); assert.equal(store.getKey(), ''); assert.equal(store.status().keySaved, false)
 } finally { await fs.rm(dir,{recursive:true,force:true}) }
})
test('unavailable storage and failed replacement preserve encrypted credentials', async () => {
 const dir = await fs.mkdtemp(path.join(tmpdir(),'alc-vault-')); const file = path.join(dir,'key.enc'); const crypto = encryption()
 try {
 const store = new CredentialStore(file,crypto); await store.load(); await store.set(key); const original = await fs.readFile(file)
 crypto.encrypt = async () => { throw new Error(key) }
 await assert.rejects(store.set(key+'-replacement'), error => error.code === 'CREDENTIAL_SAVE_FAILED' && !error.message.includes(key))
 assert.equal(store.getKey(),key); assert.deepEqual(await fs.readFile(file),original)
 crypto.available = async () => false
 await assert.rejects(store.set(key),{code:'SECURE_STORAGE_UNAVAILABLE'})
 const locked = new CredentialStore(file,crypto); await locked.load(); assert.equal(locked.getKey(),''); assert.equal(locked.status().keySaved,true); assert.ok(locked.status().keyWarning)
 assert.deepEqual(await fs.readFile(file),original)
 } finally { await fs.rm(dir,{recursive:true,force:true}) }
})
test('corrupt vault stays recoverable and key IPC rejects arbitrary fields', async () => {
 const dir = await fs.mkdtemp(path.join(tmpdir(),'alc-vault-'))
 try {
 const file = path.join(dir,'key.enc'); await fs.writeFile(file,'corrupt')
 const store = new CredentialStore(file,encryption()); await store.load()
 assert.equal(store.getKey(),''); assert.ok(store.status().keyWarning)
 await store.set(key); assert.equal(store.getKey(),key)
 assert.deepEqual(validatePayload(saveKeySchema,{key}),{key})
 for(const payload of [{key,extra:true},{key:'bad'},{key:key+'\ninvalid'},{}]) assert.throws(()=>validatePayload(saveKeySchema,payload),{code:'VALIDATION'})
 } finally { await fs.rm(dir,{recursive:true,force:true}) }
})
