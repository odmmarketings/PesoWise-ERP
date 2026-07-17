"use client"
import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, ArrowLeft, CheckCircle } from "lucide-react"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Failed to send reset email.")
        return
      }

      setSent(true)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="text-center py-4">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Check your email</h2>
        <p className="text-slate-500 text-sm mb-6">
          We sent a password reset link to <strong>{email}</strong>. Check your inbox (and spam folder).
        </p>
        <Link href="/login" className="text-green-600 text-sm font-medium hover:underline">
          Back to login
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Reset password</h1>
        <p className="text-slate-500 text-sm mt-1">Enter your email and we&apos;ll send you a reset link.</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email Address</Label>
          <Input
            id="email"
            type="email"
            placeholder="juan@email.com"
            className="mt-1"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</> : "Send Reset Link"}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <Link href="/login" className="text-sm text-slate-500 hover:text-slate-700 inline-flex items-center gap-1">
          <ArrowLeft className="w-3 h-3" /> Back to login
        </Link>
      </div>
    </>
  )
}
