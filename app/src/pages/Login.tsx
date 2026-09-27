import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/providers/trpc";
import { useLocation, useNavigate } from "react-router";
import { announcePendingChange, outageClock, pendingSignOut, sessionEpoch, withSessionLock } from "@/lib/sessionGrace";
import { ShieldCheck, PencilRuler, DatabaseZap, Waypoints, ArrowRight, Loader2 } from "lucide-react";

/** A new session: the old one's sign-out and outage no longer apply, in any tab. */
function signedIn() {
  sessionEpoch.bump();
  pendingSignOut.clear();
  outageClock.reset();
  announcePendingChange();
}

const DEMO_PERSONAS = [
  {
    role: "admin" as const,
    name: "Elena Cortez",
    title: "Chief Data Officer",
    email: "demo-admin@acme-ontology.com",
    description: "Full system governance, ontology lifecycle, twin operations & platform administration",
    color: "#FB7185",
    badge: "Full Governance",
    initials: "EC",
    icon: ShieldCheck,
    path: "/app",
    targetLabel: "System Dashboard",
  },
  {
    role: "ontologist" as const,
    name: "Dr. James Wei",
    title: "Lead Ontology Engineer",
    email: "demo-ontologist@acme-ontology.com",
    description: "Schema modeling, SHACL constraints, OWL classes & semantic relationship validation",
    color: "#A78BFA",
    badge: "Ontology Studio",
    initials: "JW",
    icon: PencilRuler,
    path: "/app/studio",
    targetLabel: "Ontology Studio",
  },
  {
    role: "editor" as const,
    name: "Priya Sharma",
    title: "Data Steward & Knowledge Engineer",
    email: "demo-editor@acme-ontology.com",
    description: "Data mapping, source synchronization, entity linking & knowledge curation",
    color: "#34D399",
    badge: "Mapping & Sync",
    initials: "PS",
    icon: DatabaseZap,
    path: "/app/mapping",
    targetLabel: "Mapping & Sync",
  },
  {
    role: "viewer" as const,
    name: "Alex Morgan",
    title: "Compliance Analyst & Explorer",
    email: "demo-viewer@acme-ontology.com",
    description: "Read-only access — graph analytics, twin telemetry visualization & compliance dashboards",
    color: "#38BDF8",
    badge: "Graph Explorer",
    initials: "AM",
    icon: Waypoints,
    path: "/app/explorer",
    targetLabel: "Graph Explorer",
  },
];

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  
  // Signed out because Ontos could not check the session for three minutes.
  const [afterOutage] = useState(
    () => (location.state as { signedOutBecause?: string } | null)?.signedOutBecause === "outage" || pendingSignOut.get(),
  );

  const utils = trpc.useUtils();

  // Offline, sign-ins fail at once rather than wait to run later, outside the lock (B5).
  const demoLoginMut = trpc.auth.demoLogin.useMutation({ networkMode: "always" });
  const loginMut = trpc.auth.login.useMutation({ networkMode: "always" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const fromPath = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;

  /**
   * Signs in. The page opens once the server has set the session cookie, so its
   * first requests are already signed in, and with the user the server
   * returned. The old session's pending sign-out and outage are cleared only
   * then, under the session lock (I5): a sign-in the server refuses, or cannot
   * answer, leaves them as they were and says why.
   */
  const signIn = async (kind: string, request: () => ReturnType<typeof loginMut.mutateAsync>, destination: string) => {
    setError(null);
    setLoading(kind);
    try {
      const user = await withSessionLock(async () => {
        const accepted = await request();
        // A session check still in flight went out without this session's
        // cookie (an ordinary sign-out's refresh, say): its answer is about the
        // old session, and must not land after the new one and sign it out.
        await utils.auth.me.cancel();
        signedIn();
        return accepted;
      });
      try {
        localStorage.setItem("ontos:active-persona", JSON.stringify(user));
      } catch {
        // Storage unavailable or disabled
      }
      utils.auth.me.setData(undefined, user);
      navigate(destination);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Sign-in failed. Please try again.");
      setLoading(null);
    }
  };

  const handleDemoLogin = (p: (typeof DEMO_PERSONAS)[number]) =>
    signIn(
      p.role,
      () => demoLoginMut.mutateAsync({ role: p.role }),
      fromPath && fromPath !== "/login" && (fromPath !== "/app" || p.path === "/app") ? fromPath : p.path,
    );

  const handleCredentialLogin = (e: React.FormEvent) => {
    e.preventDefault();
    void signIn(
      "credentials",
      () => loginMut.mutateAsync({ email, password }),
      fromPath && fromPath !== "/login" ? fromPath : "/app",
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 relative overflow-hidden p-4">
      {/* Ambient background glow effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-15%] left-[-10%] w-[55%] h-[55%] rounded-full bg-indigo-500/10 blur-[140px]" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[50%] h-[50%] rounded-full bg-teal-500/10 blur-[140px]" />
        <div className="absolute top-[35%] right-[20%] w-[30%] h-[30%] rounded-full bg-purple-500/5 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-2xl">
        {/* Platform Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-teal-400 flex items-center justify-center shadow-xl shadow-indigo-500/20 ring-1 ring-white/20">
              <span className="text-white font-extrabold text-xl tracking-tight">O</span>
            </div>
            <span className="text-3xl font-extrabold text-white tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text">
              Ontos
            </span>
          </div>
          <p className="text-sm font-medium text-slate-400">
            Enterprise Ontology & Digital Twin Platform
          </p>
        </div>

        {afterOutage && (
          <div role="status" className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 shadow-lg backdrop-blur-md">
            You were signed out because Ontos could not check your session for three minutes. Sign in again to continue.
          </div>
        )}

        <Card className="border-slate-800/80 bg-slate-900/75 backdrop-blur-2xl shadow-2xl shadow-black/60 ring-1 ring-white/5">
          <CardHeader className="text-center pb-4 pt-6">
            <CardTitle className="text-xl font-bold text-white tracking-tight">
              Select a Persona
            </CardTitle>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              Choose a role to enter its designated workspace immediately
            </p>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6">
            {/* Personas 2x2 Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {DEMO_PERSONAS.map((p) => {
                const IconComponent = p.icon;
                return (
                  <button
                    key={p.role}
                    onClick={() => void handleDemoLogin(p)}
                    disabled={!!loading}
                    aria-busy={loading === p.role}
                    className="group relative p-4 rounded-xl border border-slate-800/90 bg-slate-850/60 hover:bg-slate-800/90 hover:border-slate-700/80 hover:shadow-xl hover:shadow-indigo-950/30 hover:-translate-y-0.5 transition-all duration-200 text-left disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-md ring-1 ring-white/15"
                          style={{
                            backgroundColor: p.color,
                            boxShadow: `0 4px 14px ${p.color}33`,
                          }}
                        >
                          {p.initials}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white group-hover:text-indigo-200 transition-colors">
                            {p.name}
                          </div>
                          <div className="text-[11px] text-slate-400 font-medium truncate">
                            {p.title}
                          </div>
                        </div>
                      </div>
                      <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-slate-700 bg-slate-800/80 text-slate-300">
                        {p.badge}
                      </span>
                    </div>

                    <p className="text-[11.5px] text-slate-400 leading-relaxed mb-3 line-clamp-2">
                      {p.description}
                    </p>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[11px] font-medium text-slate-400 group-hover:text-indigo-300 transition-colors">
                      <span className="flex items-center gap-1.5">
                        <IconComponent className="size-3.5" />
                        {p.targetLabel}
                      </span>
                      {loading === p.role ? (
                        <Loader2 className="size-3.5 animate-spin" aria-label="Signing in" />
                      ) : (
                        <ArrowRight className="size-3.5 transform group-hover:translate-x-1 transition-transform" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {error && (
              <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center">
                {error}
              </div>
            )}

            {/* Credentials: the way in when persona login is off, as it is in production */}
            <div className="relative py-1">
              <Separator className="bg-slate-800/80" />
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900 px-3 text-[10px] text-slate-500 uppercase tracking-widest">
                or sign in
              </span>
            </div>
            <form onSubmit={handleCredentialLogin} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="login-email" className="text-xs text-slate-400">
                    Email
                  </Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-9 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-indigo-500 focus:ring-indigo-500/20"
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="login-password" className="text-xs text-slate-400">
                    Password
                  </Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-9 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-indigo-500 focus:ring-indigo-500/20"
                    autoComplete="current-password"
                  />
                </div>
              </div>
              <Button
                type="submit"
                className="w-full h-9 bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                disabled={!!loading || !email || !password}
              >
                {loading === "credentials" ? "Signing in…" : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-slate-600 mt-6 tracking-wide">
          Ontos v1.0 · Enterprise Ontology & Digital Twin Platform
        </p>
      </div>
    </div>
  );
}
