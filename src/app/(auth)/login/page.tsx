"use client"
import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, Loader2 } from "lucide-react"

const SECURITY_QUESTIONS = [
  "What is your mother's maiden name?",
  "What was the name of your first pet?",
  "What elementary school did you attend?",
  "What is your birth city?",
]

export default function LoginPage() {
  const router = useRouter()
  const [form, setForm] = useState({ email: "", password: "" })
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    try {
      const saved = localStorage.getItem("pesowise_remember_email")
      if (saved) { setForm(f => ({ ...f, email: saved })); setRemember(true) }
    } catch {}
  }, [])
  // Company logo + access request (User Management): logo uploaded by the admin shows here;
  // bagong ERP user (PENDING sa roster, walang username pa) ay nagre-request ng access dito
  // mismo — pipili sila ng sariling username/password — bago i-enable ng admin.
  const [logo, setLogo] = useState("")
  useEffect(() => { try { setLogo(localStorage.getItem("pesowise_company_logo") || "") } catch {} }, [])

  const [screen, setScreen] = useState<"signin" | "request">("signin")
  const [req, setReq] = useState({ employeeId: "", fullName: "", email: "", username: "", password: "", confirmPassword: "", question: "", answer: "" })
  const [showReqPw, setShowReqPw] = useState(false)
  const [showReqPw2, setShowReqPw2] = useState(false)
  const [reqError, setReqError] = useState("")
  const [reqDone, setReqDone] = useState(false)
  const [reqSubmitting, setReqSubmitting] = useState(false)
  const setR = (k: keyof typeof req, v: string) => setReq(p => ({ ...p, [k]: v }))

  async function submitRequestAccess() {
    setReqError("")
    const employeeId = req.employeeId.trim()
    const fullName = req.fullName.trim()
    const email = req.email.trim()
    const username = req.username.trim()
    if (!employeeId || !fullName || !email || !username || !req.password || !req.confirmPassword || !req.question || !req.answer.trim()) {
      setReqError("Please complete every field."); return
    }
    if (req.password.length < 8) { setReqError("Password must be at least 8 characters."); return }
    if (req.password !== req.confirmPassword) { setReqError("Password and Re-type Password do not match."); return }
    setReqSubmitting(true)
    try {
      const res = await fetch("/api/auth/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeNo: employeeId, fullName, email, username, password: req.password }),
      })
      const data = await res.json()
      if (!res.ok) { setReqError(data.error || "Something went wrong with the request — please try again."); return }
      setReqDone(true)
    } catch { setReqError("Something went wrong with the request — please try again.") } finally { setReqSubmitting(false) }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Invalid email or password.")
        return
      }

      try {
        if (remember) localStorage.setItem("pesowise_remember_email", form.email)
        else localStorage.removeItem("pesowise_remember_email")
      } catch {}

      router.push("/business/dashboard")
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (screen === "request") return (
    <>
      {logo && (
        <div className="mb-4 flex justify-center">
          <img src={logo} alt="Company logo" className="max-h-20 object-contain" />
        </div>
      )}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Request Access</h1>
        <p className="text-slate-500 text-sm mt-1">Kindly fill up the form and inform your Admin for your access.</p>
      </div>

      {reqDone && (
        <div className="mb-4 p-3 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-700">
          Account created — contact your administrator for verification.
        </div>
      )}
      {reqError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {reqError}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <Label htmlFor="employeeId">Employee No.</Label>
          <Input id="employeeId" placeholder="e.g. U-3" className="mt-1" value={req.employeeId} onChange={e => setR("employeeId", e.target.value)} disabled={reqDone} />
        </div>
        <div>
          <Label htmlFor="fullName">Full Name</Label>
          <Input id="fullName" placeholder="Juan Dela Cruz" className="mt-1" value={req.fullName} onChange={e => setR("fullName", e.target.value)} disabled={reqDone} />
        </div>
        <div>
          <Label htmlFor="reqEmail">Company Email</Label>
          <Input id="reqEmail" type="email" placeholder="juan@company.com — this is your login" className="mt-1" value={req.email} onChange={e => setR("email", e.target.value)} disabled={reqDone} />
        </div>
        <div>
          <Label htmlFor="reqUsername">Username</Label>
          <Input id="reqUsername" placeholder="choose a username" className="mt-1" value={req.username} onChange={e => setR("username", e.target.value)} disabled={reqDone} />
        </div>
        <div>
          <Label htmlFor="reqPassword">Password</Label>
          <div className="relative mt-1">
            <Input id="reqPassword" type={showReqPw ? "text" : "password"} placeholder="Password" value={req.password} onChange={e => setR("password", e.target.value)} disabled={reqDone} />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setShowReqPw(s => !s)}>
              {showReqPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <Label htmlFor="reqPassword2">Re-type password</Label>
          <div className="relative mt-1">
            <Input id="reqPassword2" type={showReqPw2 ? "text" : "password"} placeholder="Re-type password" value={req.confirmPassword} onChange={e => setR("confirmPassword", e.target.value)} disabled={reqDone} />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setShowReqPw2(s => !s)}>
              {showReqPw2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <Label htmlFor="reqQuestion">Select Question</Label>
          <select id="reqQuestion" className="mt-1 flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
            value={req.question} onChange={e => setR("question", e.target.value)} disabled={reqDone}>
            <option value="">-- Select Question --</option>
            {SECURITY_QUESTIONS.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="reqAnswer">Security Question Answer</Label>
          <Input id="reqAnswer" placeholder="Sagot" className="mt-1" value={req.answer} onChange={e => setR("answer", e.target.value)} disabled={reqDone} />
        </div>

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => { setScreen("signin"); setReqDone(false); setReqError(""); setReq({ employeeId: "", fullName: "", email: "", username: "", password: "", confirmPassword: "", question: "", answer: "" }) }}>
            Back
          </Button>
          {!reqDone && (
            <Button type="button" className="flex-1" disabled={reqSubmitting} onClick={submitRequestAccess}>
              {reqSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</> : "Submit"}
            </Button>
          )}
        </div>
      </div>
    </>
  )

  return (
    <>
      {logo && (
        <div className="mb-4 flex justify-center">
          <img src={logo} alt="Company logo" className="max-h-20 object-contain" />
        </div>
      )}
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Sign In</h1>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email">Username</Label>
          <Input
            id="email"
            type="email"
            placeholder="juan@email.com"
            className="mt-1"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            required
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <div className="relative mt-1">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Your password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              required
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setShowPassword(s => !s)}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="accent-green-600" />
            Remember
          </label>
          <Link href="/forgot-password" className="text-sm text-green-600 hover:underline">
            Forgot Password?
          </Link>
        </div>

        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</> : "Login"}
        </Button>
      </form>

      <Button type="button" variant="secondary" className="w-full mt-4" onClick={() => setScreen("request")}>
        Request Access
      </Button>
    </>
  )
}
