import { Link } from '@/i18n/navigation'

export default function ForbiddenPage() {
  return (
    <div className="max-w-[640px] mx-auto px-5 py-16 text-center">
      <span className="eyebrow">403</span>
      <h1 className="type-h1" style={{ margin: '8px 0 12px' }}>Access denied</h1>
      <p className="sans" style={{ marginBottom: 20 }}>
        Your account role does not have access to this area.
      </p>
      <Link href="/" className="btn btn-primary">Back to dashboard</Link>
    </div>
  )
}
