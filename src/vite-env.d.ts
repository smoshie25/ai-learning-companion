/// <reference types="vite/client" />
import type { CompanionBridge } from '../shared/contracts.cjs'
declare global { interface Window { companion?: CompanionBridge } }
