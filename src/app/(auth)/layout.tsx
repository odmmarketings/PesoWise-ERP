import Link from "next/link"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-green-950 to-slate-900 flex flex-col items-center justify-center p-4">
      <Link href="/" className="flex items-center gap-2 mb-8 hover:opacity-80 transition-opacity">
        <div className="w-9 h-9 rounded-xl bg-green-600 flex items-center justify-center text-white font-bold">₱</div>
        <span className="font-bold text-white text-xl">PesoWise</span>
      </Link>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
        {children}
      </div>
      <p className="text-slate-500 text-xs mt-6">© {new Date().getFullYear()} PesoWise. All rights reserved.</p>
    </div>
  )
}
