import type { DatabaseSync } from 'node:sqlite'
import type { SecretEncryption } from '../ai/credentials.cjs'
import { ActionRepository } from './repository.cjs'
import { ActionEngine } from './engine.cjs'
import { ProviderVault } from '../integrations/vault.cjs'
import { GoogleOAuth } from '../integrations/google-oauth.cjs'
import { GoogleCalendarAdapter,GmailAdapter } from '../integrations/google-adapters.cjs'
export function createActionRuntime(db:DatabaseSync,directory:string,encryption:SecretEncryption,open:(url:string)=>Promise<void>){
 const repository=new ActionRepository(db);repository.recoverStale()
 const vault=new ProviderVault(directory,encryption)
 const oauth=new GoogleOAuth(vault,repository,open)
 const engine=new ActionEngine(repository,new GoogleCalendarAdapter(oauth),new GmailAdapter(oauth))
 return {repository,vault,oauth,engine}
}
