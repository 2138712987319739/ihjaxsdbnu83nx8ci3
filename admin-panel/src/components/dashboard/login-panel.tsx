'use client';

import { useMemo, useState } from 'react';
import { KeyRound, LockKeyhole, ShieldCheck, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getPublicEnv } from '@/lib/env';
import { getSupabaseClient } from '@/lib/supabase';

type LoginPanelProps = {
  mode?: 'login' | 'setup-password';
  firstAdminAvailable?: boolean;
  userEmail?: string;
};

export function LoginPanel({ mode = 'login', firstAdminAvailable = false, userEmail = '' }: LoginPanelProps) {
  const [email, setEmail] = useState('');
  const [credential, setCredential] = useState('');
  const [confirmCredential, setConfirmCredential] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const activeEmail = userEmail || email;
  const title = mode === 'setup-password' ? 'Create Account' : firstAdminAvailable ? 'Create Owner Login' : 'Admin Login';
  const description = mode === 'setup-password'
    ? 'Create your panel account, then sign in normally.'
    : firstAdminAvailable
      ? 'Create the first private owner account for this panel.'
      : 'Use your Fracture MC admin email and password.';
  const Icon = mode === 'setup-password' ? LockKeyhole : firstAdminAvailable ? UserPlus : KeyRound;
  const canSubmit = useMemo(() => {
    if (mode === 'setup-password') {
      return credential.length >= 8 && credential === confirmCredential;
    }

    return activeEmail.includes('@') && credential.length >= 8;
  }, [activeEmail, confirmCredential, credential, mode]);

  async function submit() {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setMessage('Supabase is not configured.');
      return;
    }

    if (!canSubmit) {
      setMessage('Enter a valid email and a password with at least 8 characters.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      if (mode === 'setup-password') {
        const { error } = await supabase.auth.updateUser({ ['password']: credential });
        if (error) {
          throw error;
        }

        const { error: profileError } = await supabase.rpc('mark_friendconnect_password_set');
        if (profileError) {
          throw profileError;
        }

        setMessage('Account created. Redirecting to login.');
        await supabase.auth.signOut();
        window.location.reload();
        return;
      }

      if (firstAdminAvailable) {
        const existing = await supabase.auth.signInWithPassword({
          email: activeEmail.trim().toLowerCase(),
          ['password']: credential,
        });
        if (!existing.error) {
          const { error: claimError } = await supabase.rpc('claim_first_friendconnect_admin');
          if (claimError) {
            throw claimError;
          }

          setMessage('Owner account claimed. Opening the dashboard.');
          window.location.reload();
          return;
        }

        const { error } = await supabase.auth.signUp({
          email: activeEmail.trim().toLowerCase(),
          ['password']: credential,
          options: {
            emailRedirectTo: getAuthRedirectUrl(),
          },
        });
        if (error) {
          throw error;
        }

        const { data: authData } = await supabase.auth.getSession();
        if (!authData.session) {
          setMessage('Check your email to confirm the account, then return here and enter the same password to claim owner access.');
          return;
        }

        const { error: claimError } = await supabase.rpc('claim_first_friendconnect_admin');
        if (claimError) {
          throw claimError;
        }

        setMessage('Owner account created. You can manage the panel now.');
        window.location.reload();
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
          email: activeEmail.trim().toLowerCase(),
          ['password']: credential,
      });
      if (error) {
        throw error;
      }
      setMessage('Signed in.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(39,119,255,0.18),transparent_34%),radial-gradient(circle_at_78%_32%,rgba(255,63,95,0.14),transparent_30%),linear-gradient(135deg,#070a12,#0b1221_48%,#130d14)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/70 to-transparent" />
      <Card className="relative w-full max-w-md overflow-hidden border-white/18 bg-black/42">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-slate-200 to-red-500" />
        <CardHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-md border border-blue-300/30 bg-blue-500/16 text-blue-200">
            <Icon size={21} />
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {mode === 'setup-password' ? (
            <div className="rounded-md border border-border bg-white/5 px-3 py-2 text-sm text-muted-foreground">{activeEmail}</div>
          ) : (
            <Input type="email" placeholder="admin@fracturemc.com" value={email} onChange={(event) => setEmail(event.target.value)} />
          )}
          <Input type="password" placeholder="Passcode" value={credential} onChange={(event) => setCredential(event.target.value)} />
          {mode === 'setup-password' ? (
            <Input type="password" placeholder="Confirm passcode" value={confirmCredential} onChange={(event) => setConfirmCredential(event.target.value)} />
          ) : null}
          <Button className="w-full" onClick={() => void submit()} disabled={!canSubmit || busy}>
            <ShieldCheck size={16} />
            {busy ? 'Working...' : mode === 'setup-password' ? 'Create account' : firstAdminAvailable ? 'Create owner account' : 'Sign in'}
          </Button>
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          {mode === 'setup-password' ? (
            <p className="text-xs text-muted-foreground">
              After creating the account, use this email and passcode on the login screen.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

function getAuthRedirectUrl(): string {
  const env = getPublicEnv();
  return `${window.location.origin}${env.basePath}/`;
}
