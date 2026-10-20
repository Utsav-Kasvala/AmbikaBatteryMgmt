import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Button,
  Card,
  HelperText,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CodeIntent, CompanyChoice, useAuth } from '../auth/AuthContext';

// Every way in is two steps: fill details → enter the 6-digit code we email.

// ── Schemas ───────────────────────────────────────────
const email = z.string().trim().toLowerCase().email('Enter a valid email');

const signInSchema = z.object({ email });

const registerSchema = z.object({
  email,
  name: z.string().trim().min(1, 'Name is required').max(100),
  companyName: z.string().trim().min(1, 'Company name is required').max(200),
});

const joinSchema = z.object({
  email,
  name: z.string().trim().min(1, 'Name is required').max(100),
  // Codes are uppercase AMB-XXXXXXXX; tolerate lowercase and pasted spaces
  invitationCode: z
    .string()
    .transform((v) => v.replace(/\s+/g, '').toUpperCase())
    .pipe(z.string().min(1, 'Invitation code is required')),
});

type SignInForm = z.output<typeof signInSchema>;
type RegisterForm = z.output<typeof registerSchema>;
type JoinFormInput = z.input<typeof joinSchema>;
type JoinForm = z.output<typeof joinSchema>;

// ── Screen ────────────────────────────────────────────
type Mode = 'signin' | 'register' | 'join';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: '#fff' }}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text variant="headlineMedium" style={styles.title}>
          Ambika Battery
        </Text>
        <Text style={styles.subtitle}>Production & Inventory Management</Text>

        <SegmentedButtons
          value={mode}
          onValueChange={(v) => setMode(v as Mode)}
          buttons={[
            { value: 'signin', label: 'Sign in' },
            { value: 'register', label: 'New company' },
            { value: 'join', label: 'Join' },
          ]}
          style={{ marginVertical: 16 }}
        />

        {/* key resets each flow's step state when switching tabs */}
        {mode === 'signin' && <SignInFlow key="signin" />}
        {mode === 'register' && <RegisterFlow key="register" />}
        {mode === 'join' && <JoinFlow key="join" />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Shared: send-code helper ──────────────────────────
// Requests a code and returns the dev code (if any) or an error message.
function useSendCode() {
  const { requestCode } = useAuth();
  const [sending, setSending] = useState(false);
  const send = async (input: { intent: CodeIntent; email: string; invitationCode?: string }) => {
    setSending(true);
    const res = await requestCode(input);
    setSending(false);
    return res;
  };
  return { send, sending };
}

type Sent = { email: string; devCode?: string };

// ── Sign in ───────────────────────────────────────────
function SignInFlow() {
  const { signIn } = useAuth();
  const { send, sending } = useSendCode();
  const [sent, setSent] = useState<Sent | null>(null);
  const [companies, setCompanies] = useState<{ code: string; list: CompanyChoice[] } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const { control, handleSubmit, formState: { errors } } = useForm<SignInForm>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: SignInForm) => {
    setServerError(null);
    const res = await send({ intent: 'signin', email: values.email });
    if (!res.ok) { setServerError(res.error ?? 'Could not send code'); return; }
    setSent({ email: values.email, devCode: res.devCode });
  };

  if (sent && companies) {
    return (
      <CompanyPicker
        companies={companies.list}
        onPick={async (companyId) => {
          const res = await signIn({ email: sent.email, code: companies.code, companyId });
          return res.ok ? null : res.error ?? 'Sign-in failed';
        }}
        onBack={() => setCompanies(null)}
      />
    );
  }

  if (sent) {
    return (
      <CodeStep
        email={sent.email}
        devCode={sent.devCode}
        resend={() => send({ intent: 'signin', email: sent.email })}
        onDevCode={(devCode) => setSent({ ...sent, devCode })}
        verify={async (code) => {
          const res = await signIn({ email: sent.email, code });
          if (res.companies) { setCompanies({ code, list: res.companies }); return null; }
          return res.ok ? null : res.error ?? 'Sign-in failed';
        }}
        verifyLabel="Sign in"
        onBack={() => setSent(null)}
      />
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <FormTextInput
        control={control}
        name="email"
        label="Your email"
        error={errors.email?.message}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      {serverError && <HelperText type="error" visible>{serverError}</HelperText>}
      <Button
        mode="contained"
        loading={sending}
        disabled={sending}
        onPress={handleSubmit(onSubmit)}
        style={styles.button}
      >
        Email me a code
      </Button>
      <Text style={styles.hint}>
        We'll email you a 6-digit code. No password needed.
      </Text>
    </View>
  );
}

// ── Register Company ──────────────────────────────────
function RegisterFlow() {
  const { registerCompany } = useAuth();
  const { send, sending } = useSendCode();
  const [sent, setSent] = useState<(Sent & { values: RegisterForm }) | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const { control, handleSubmit, formState: { errors } } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', name: '', companyName: '' },
  });

  const onSubmit = async (values: RegisterForm) => {
    setServerError(null);
    const res = await send({ intent: 'register', email: values.email });
    if (!res.ok) { setServerError(res.error ?? 'Could not send code'); return; }
    setSent({ email: values.email, devCode: res.devCode, values });
  };

  if (sent) {
    return (
      <CodeStep
        email={sent.email}
        devCode={sent.devCode}
        resend={() => send({ intent: 'register', email: sent.email })}
        onDevCode={(devCode) => setSent({ ...sent, devCode })}
        verify={async (code) => {
          const res = await registerCompany({ ...sent.values, code });
          return res.ok ? null : res.error ?? 'Registration failed';
        }}
        verifyLabel="Create company"
        onBack={() => setSent(null)}
      />
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <FormTextInput
        control={control}
        name="email"
        label="Your email"
        error={errors.email?.message}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <FormTextInput control={control} name="name" label="Your name" error={errors.name?.message} />
      <FormTextInput
        control={control}
        name="companyName"
        label="Company name"
        error={errors.companyName?.message}
      />
      {serverError && <HelperText type="error" visible>{serverError}</HelperText>}
      <Button
        mode="contained"
        loading={sending}
        disabled={sending}
        onPress={handleSubmit(onSubmit)}
        style={styles.button}
      >
        Continue
      </Button>
      <Text style={styles.hint}>
        You'll become the company's first Admin. You'll get an invitation code to share
        with your employees.
      </Text>
    </View>
  );
}

// ── Join Company ──────────────────────────────────────
function JoinFlow() {
  const { joinCompany } = useAuth();
  const { send, sending } = useSendCode();
  const [sent, setSent] = useState<(Sent & { values: JoinForm }) | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const { control, handleSubmit, formState: { errors } } = useForm<JoinFormInput, unknown, JoinForm>({
    resolver: zodResolver(joinSchema),
    defaultValues: { email: '', name: '', invitationCode: '' },
  });

  const onSubmit = async (values: JoinForm) => {
    setServerError(null);
    const res = await send({
      intent: 'join',
      email: values.email,
      invitationCode: values.invitationCode,
    });
    if (!res.ok) { setServerError(res.error ?? 'Could not send code'); return; }
    setSent({ email: values.email, devCode: res.devCode, values });
  };

  if (sent) {
    return (
      <CodeStep
        email={sent.email}
        devCode={sent.devCode}
        resend={() =>
          send({ intent: 'join', email: sent.email, invitationCode: sent.values.invitationCode })
        }
        onDevCode={(devCode) => setSent({ ...sent, devCode })}
        verify={async (code) => {
          const res = await joinCompany({ ...sent.values, code });
          return res.ok ? null : res.error ?? 'Join failed';
        }}
        verifyLabel="Join company"
        onBack={() => setSent(null)}
      />
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <FormTextInput
        control={control}
        name="email"
        label="Your email"
        error={errors.email?.message}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <FormTextInput control={control} name="name" label="Your name" error={errors.name?.message} />
      <FormTextInput
        control={control}
        name="invitationCode"
        label="Company invitation code"
        placeholder="e.g. AMB-ABCD1234"
        error={errors.invitationCode?.message}
        autoCapitalize="characters"
      />
      {serverError && <HelperText type="error" visible>{serverError}</HelperText>}
      <Button
        mode="contained"
        loading={sending}
        disabled={sending}
        onPress={handleSubmit(onSubmit)}
        style={styles.button}
      >
        Continue
      </Button>
      <Text style={styles.hint}>
        Ask your company Admin for the invitation code. You'll join as a regular User.
      </Text>
    </View>
  );
}

// ── Step 2: enter the emailed code ────────────────────
const RESEND_COOLDOWN_S = 30;

function CodeStep({
  email: emailAddr,
  devCode,
  resend,
  onDevCode,
  verify,
  verifyLabel,
  onBack,
}: {
  email: string;
  devCode?: string;
  resend: () => Promise<{ ok: boolean; error?: string; devCode?: string; retryAfterSeconds?: number }>;
  onDevCode: (devCode?: string) => void;
  /** Returns an error message, or null on success */
  verify: (code: string) => Promise<string | null>;
  verifyLabel: string;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async () => {
    setError(null);
    setInfo(null);
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code'); return; }
    setVerifying(true);
    const err = await verify(code);
    setVerifying(false);
    if (err) setError(err);
  };

  const doResend = async () => {
    setError(null);
    setInfo(null);
    setResending(true);
    const res = await resend();
    setResending(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not resend code');
      if (res.retryAfterSeconds) setCooldown(res.retryAfterSeconds);
      return;
    }
    setCode('');
    onDevCode(res.devCode);
    setInfo('A new code is on its way. Earlier codes no longer work.');
    setCooldown(RESEND_COOLDOWN_S);
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.stepTitle}>Check your email</Text>
      <Text style={styles.hint}>
        We sent a 6-digit code to <Text style={{ fontWeight: '700' }}>{emailAddr}</Text>. It
        expires in 10 minutes.
      </Text>

      {devCode && (
        <Card style={styles.devCard}>
          <Card.Content>
            <Text style={styles.devText}>
              Dev mode (this address isn't really emailed): your code is{' '}
              <Text style={{ fontWeight: '700' }}>{devCode}</Text>
            </Text>
          </Card.Content>
        </Card>
      )}

      <TextInput
        mode="outlined"
        label="6-digit code"
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        style={styles.codeInput}
        error={!!error}
        autoFocus
      />
      {error && <HelperText type="error" visible>{error}</HelperText>}
      {info && <HelperText type="info" visible>{info}</HelperText>}

      <Button
        mode="contained"
        loading={verifying}
        disabled={verifying || code.length !== 6}
        onPress={submit}
        style={styles.button}
      >
        {verifyLabel}
      </Button>
      <Button onPress={doResend} loading={resending} disabled={resending || verifying || cooldown > 0}>
        {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
      </Button>
      <Button onPress={onBack} disabled={verifying}>
        Use a different email
      </Button>
    </View>
  );
}

// ── Sign-in step 3: email belongs to several companies ─
function CompanyPicker({
  companies,
  onPick,
  onBack,
}: {
  companies: CompanyChoice[];
  /** Returns an error message, or null on success */
  onPick: (companyId: number) => Promise<string | null>;
  onBack: () => void;
}) {
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (id: number) => {
    setError(null);
    setPending(id);
    const err = await onPick(id);
    setPending(null);
    if (err) setError(err);
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.stepTitle}>Choose a company</Text>
      <Text style={styles.hint}>Your email is registered with more than one company.</Text>
      {companies.map((c) => (
        <Card key={c.id} style={{ backgroundColor: '#fff' }} onPress={() => pick(c.id)} disabled={pending !== null}>
          <Card.Title
            title={c.name}
            subtitle={c.role === 'ADMIN' ? 'Admin' : 'User'}
            right={() => (pending === c.id ? <Text style={{ marginRight: 16 }}>…</Text> : null)}
          />
        </Card>
      ))}
      {error && <HelperText type="error" visible>{error}</HelperText>}
      <Button onPress={onBack} disabled={pending !== null}>Back</Button>
    </View>
  );
}

// ── Reusable controller + TextInput ───────────────────
type FormTextInputProps = {
  control: any;
  name: string;
  label: string;
  error?: string;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'email-address';
};

function FormTextInput({
  control,
  name,
  label,
  error,
  placeholder,
  autoCapitalize,
  keyboardType,
}: FormTextInputProps) {
  return (
    <>
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            mode="outlined"
            label={label}
            placeholder={placeholder}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={!!error}
            autoCapitalize={autoCapitalize}
            keyboardType={keyboardType}
            autoCorrect={false}
          />
        )}
      />
      {error && (
        <HelperText type="error" visible>
          {error}
        </HelperText>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingTop: 60,
    gap: 4,
  },
  title: { fontWeight: '700' },
  subtitle: { color: '#666', marginTop: 4, marginBottom: 12 },
  button: { marginTop: 12 },
  hint: { fontSize: 12, color: '#666', marginTop: 8, lineHeight: 18 },
  stepTitle: { fontSize: 18, fontWeight: '700' },
  codeInput: { fontSize: 22, letterSpacing: 8, textAlign: 'center' },
  devCard: { backgroundColor: '#fef3c7' },
  devText: { color: '#92400e', fontSize: 13 },
});
