import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Button,
  HelperText,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../auth/AuthContext';

// ── Schemas ───────────────────────────────────────────
const registerSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  name: z.string().trim().min(1, 'Name is required').max(100),
  companyName: z.string().trim().min(1, 'Company name is required').max(200),
});

const joinSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  name: z.string().trim().min(1, 'Name is required').max(100),
  invitationCode: z.string().trim().min(1, 'Invitation code is required'),
});

type RegisterForm = z.infer<typeof registerSchema>;
type JoinForm = z.infer<typeof joinSchema>;

// ── Screen ────────────────────────────────────────────
type Mode = 'register' | 'join';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('register');
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
            { value: 'register', label: 'Register Company' },
            { value: 'join', label: 'Join Company' },
          ]}
          style={{ marginVertical: 16 }}
        />

        {mode === 'register' ? <RegisterFormView /> : <JoinFormView />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Register Company form ─────────────────────────────
function RegisterFormView() {
  const { registerCompany } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, formState: { errors } } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', name: '', companyName: '' },
  });

  const onSubmit = async (values: RegisterForm) => {
    setServerError(null);
    setSubmitting(true);
    const result = await registerCompany(values);
    setSubmitting(false);
    if (!result.ok) setServerError(result.error ?? 'Registration failed');
  };

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
      <FormTextInput
        control={control}
        name="name"
        label="Your name"
        error={errors.name?.message}
      />
      <FormTextInput
        control={control}
        name="companyName"
        label="Company name"
        error={errors.companyName?.message}
      />
      {serverError && (
        <HelperText type="error" visible>
          {serverError}
        </HelperText>
      )}
      <Button
        mode="contained"
        loading={submitting}
        disabled={submitting}
        onPress={handleSubmit(onSubmit)}
        style={styles.button}
      >
        Create company
      </Button>
      <Text style={styles.hint}>
        You'll become the company's first Admin. You'll get an invitation code to share
        with your employees.
      </Text>
    </View>
  );
}

// ── Join Company form ─────────────────────────────────
function JoinFormView() {
  const { joinCompany } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, formState: { errors } } = useForm<JoinForm>({
    resolver: zodResolver(joinSchema),
    defaultValues: { email: '', name: '', invitationCode: '' },
  });

  const onSubmit = async (values: JoinForm) => {
    setServerError(null);
    setSubmitting(true);
    const result = await joinCompany({
      email: values.email,
      name: values.name,
      invitationCode: values.invitationCode.trim(),
    });
    setSubmitting(false);
    if (!result.ok) setServerError(result.error ?? 'Join failed');
  };

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
      <FormTextInput
        control={control}
        name="name"
        label="Your name"
        error={errors.name?.message}
      />
      <FormTextInput
        control={control}
        name="invitationCode"
        label="Company invitation code"
        placeholder="e.g. AMB-ABCD1234"
        error={errors.invitationCode?.message}
        autoCapitalize="characters"
      />
      {serverError && (
        <HelperText type="error" visible>
          {serverError}
        </HelperText>
      )}
      <Button
        mode="contained"
        loading={submitting}
        disabled={submitting}
        onPress={handleSubmit(onSubmit)}
        style={styles.button}
      >
        Join company
      </Button>
      <Text style={styles.hint}>
        Ask your company Admin for the invitation code. You'll join as a regular User.
      </Text>
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
});
