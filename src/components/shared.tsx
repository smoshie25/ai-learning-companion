import type { ReactNode } from 'react'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import { Button } from './ui/button'
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span> }
export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) { return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div> }
export function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) { return <div className="section-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div> }
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="empty-state"><div className="icon-tile"><Sparkles size={24} /></div><h3>{title}</h3><p>{description}</p>{action}</div> }
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <Button variant="ghost" size="sm" onClick={onClick}>{children}<ArrowUpRight size={15} /></Button> }
