import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/src/auth/AuthProvider';
import { sendOtp, verifyOtp } from '@/src/auth/auth-api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const { linkError, clearLinkError } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedEmail = email.trim();
  const emailValid = EMAIL_RE.test(trimmedEmail);

  async function requestCode() {
    if (!emailValid || busy) return;
    setBusy(true);
    setError(null);
    clearLinkError();
    try {
      await sendOtp(trimmedEmail);
      setCode('');
      setStep('code');
    } catch {
      setError('코드를 보내지 못했어요. 잠시 후 다시 시도해 주세요');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(trimmedEmail, code);
    } catch {
      setError('코드가 올바르지 않거나 만료되었어요');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 justify-center gap-4 bg-background px-6">
      <Text className="text-2xl font-bold">Cart Note</Text>
      {linkError ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {linkError}
        </Text>
      ) : null}
      {step === 'email' ? (
        <>
          <Input
            placeholder="이메일"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          {error ? (
            <Text accessibilityRole="alert" className="text-destructive">
              {error}
            </Text>
          ) : null}
          <Button onPress={requestCode} disabled={!emailValid || busy}>
            <Text>코드 받기</Text>
          </Button>
        </>
      ) : (
        <>
          <Text>메일로 받은 6자리 코드</Text>
          <Input
            placeholder="000000"
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
          />
          {error ? (
            <Text accessibilityRole="alert" className="text-destructive">
              {error}
            </Text>
          ) : null}
          <Button onPress={submitCode} disabled={code.length !== 6 || busy}>
            <Text>확인</Text>
          </Button>
          <Button variant="ghost" onPress={requestCode} disabled={busy}>
            <Text>코드 다시 받기</Text>
          </Button>
          <Button
            variant="ghost"
            onPress={() => {
              setStep('email');
              setCode('');
              setError(null);
            }}
          >
            <Text>이메일 다시 입력</Text>
          </Button>
        </>
      )}
    </View>
  );
}
