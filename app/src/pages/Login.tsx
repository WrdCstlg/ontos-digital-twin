import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/providers/trpc";
import { useNavigate } from "react-router";

const DEMO_PERSONAS = [
  {
    role: "admin" as const,
    name: "Elena Cortez",
    title: "Chief Data Officer",
    description: "Full system access — ontology, twin, admin controls",
    color: "#FB7185",
    initials: "EC",
  },
  {
    role: "ontologist" as const,
    name: "Dr. James Wei",
    title: "Ontology Engineer",
    description: "Class/property editing, version management, SHACL",
    color: "#A78BFA",
    initials: "JW",
  },
  {
    role: "editor" as const,
    name: "Priya Sharma",
    title: "Data Steward",
    description: "Mapping, sync jobs, knowledge graph curation",
    color: "#34D399",
    initials: "PS",
  },
  {
    role: "viewer" as const,
    name: "Alex Morgan",
    title: "Compliance Analyst",
    description: "Read-only — dashboards, insights, graph explorer",
    color: "#38BDF8",
    initials: "AM",
  },
];

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const demoLoginMut = trpc.auth.demoLogin.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate("/app");
    },
    onError: (err) => {
      setError(err.message);
      setLoading(null);
    },
  });

  const loginMut = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate("/app");
    },
    onError: (err) => {
      setError(err.message);
      setLoading(null);
    },
  });

  const handleDemoLogin = (role: "admin" | "ontologist" | "editor" | "viewer") => {
    setError(null);
    setLoading(role);
    demoLoginMut.mutate({ role });
  };

  const handleCredentialLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading("credentials");
    loginMut.mutate({ email, password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 relative overflow-hidden">
      {/* Ambient background effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/5 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] rounded-full bg-teal-500/5 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-lg px-4">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-teal-400 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <span className="text-white font-bold text-lg">O</span>
            </div>
            <span className="text-2xl font-bold text-white tracking-tight">
              Ontos
            </span>
          </div>
          <p className="text-sm text-slate-400">
            Enterprise Ontology & Digital Twin Platform
          </p>
        </div>

        <Card className="border-slate-800 bg-slate-900/80 backdrop-blur-xl shadow-2xl">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-lg font-semibold text-white">
              Select a Persona
            </CardTitle>
            <p className="text-xs text-slate-400 mt-1">
              Choose a role to explore the platform instantly
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Demo Personas Grid */}
            <div className="grid grid-cols-2 gap-2">
              {DEMO_PERSONAS.map((p) => (
                <button
                  key={p.role}
                  onClick={() => handleDemoLogin(p.role)}
                  disabled={!!loading}
                  className="group relative p-3 rounded-lg border border-slate-700/50 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-600 transition-all duration-200 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                      style={{ backgroundColor: p.color }}
                    >
                      {loading === p.role ? (
                        <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        p.initials
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate">
                        {p.name}
                      </div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                        {p.title}
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-tight">
                    {p.description}
                  </p>
                </button>
              ))}
            </div>

            {/* Error */}
            {error && (
              <div className="p-2 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center">
                {error}
              </div>
            )}

            <div className="relative">
              <Separator className="bg-slate-700/50" />
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900 px-3 text-[10px] text-slate-500 uppercase tracking-widest">
                or sign in
              </span>
            </div>

            {/* Credentials Form */}
            <form onSubmit={handleCredentialLogin} className="space-y-3">
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
              <Button
                type="submit"
                className="w-full h-9 bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                disabled={!!loading || !email}
              >
                {loading === "credentials" ? "Signing in…" : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-slate-600 mt-6">
          Ontos v1.0 · Enterprise Ontology & Digital Twin Platform
        </p>
      </div>
    </div>
  );
}
