import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';

type Toast = { id: number; message: string };
type Listener = (toasts: Toast[]) => void;

const DURATION_MS = 3000;
let seq = 0;
let toasts: Toast[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(toasts);
}

function push(message: string) {
  const id = ++seq;
  toasts = [...toasts, { id, message }].slice(-3);
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, DURATION_MS);
}

export const toast = {
  error: (message: string) => push(message),
};

/** 루트 레이아웃에 한 번 렌더링한다. */
export function ToastHost() {
  const [items, setItems] = useState<Toast[]>(toasts);
  useEffect(() => {
    listeners.add(setItems);
    setItems(toasts);
    return () => void listeners.delete(setItems);
  }, []);
  if (items.length === 0) return null;
  return (
    <View pointerEvents="none" className="absolute inset-x-0 bottom-12 items-center gap-2 px-4">
      {items.map((t) => (
        <View key={t.id} className="rounded-lg bg-foreground px-4 py-3">
          <Text className="text-background">{t.message}</Text>
        </View>
      ))}
    </View>
  );
}
