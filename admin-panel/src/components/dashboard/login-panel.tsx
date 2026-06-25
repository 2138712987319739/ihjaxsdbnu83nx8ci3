'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getSupabaseClient } from '@/lib/supabase';

export function LoginPanel() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  async function signIn() {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setMessage('Supabase is not configured.');
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.href,
      },
    });

    setMessage(error ? error.message : 'Check your email for the sign-in link.');
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/16 text-blue-200">
            <KeyRound size={20} />
          </div>
          <CardTitle>Admin Login</CardTitle>
          <CardDescription>Use an allowed admin email to access FriendConnect controls.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input type="email" placeholder="admin@fracturemc.com" value={email} onChange={(event) => setEmail(event.target.value)} />
          <Button className="w-full" onClick={() => void signIn()} disabled={!email.includes('@')}>Send login link</Button>
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
