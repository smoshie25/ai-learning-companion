export interface MicrophonePermissionRequest {isMainFrame:boolean;requestingUrl:string;rendererURL:string;mediaTypes?:string[]}
export interface MicrophonePermissionDependencies {authorized():boolean;confirm():Promise<boolean>;status():string;platform:string;askOS():Promise<boolean>;offerSettings():Promise<void>}
/** Device approval never overrides trusted-frame, active-owner, or participant consent checks. */
export async function approveMicrophone(request:MicrophonePermissionRequest,deps:MicrophonePermissionDependencies):Promise<boolean>{
 const eligible=()=>request.isMainFrame&&request.requestingUrl.split('#')[0]===request.rendererURL&&request.mediaTypes?.length===1&&request.mediaTypes[0]==='audio'&&deps.authorized()
 try{
  if(!eligible())return false
  const initial=deps.status()
  if(initial==='denied'||initial==='restricted'){await deps.offerSettings();return false}
  if(!await deps.confirm()||!eligible())return false
  if(deps.platform==='darwin'&&initial==='not-determined'&&!await deps.askOS())return false
  if(!eligible())return false
  const status=deps.status()
  if(status==='denied'||status==='restricted'){await deps.offerSettings();return false}
  return eligible()
 }catch{return false}
}
