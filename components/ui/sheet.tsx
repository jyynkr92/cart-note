import { inputClassName } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { THEME } from '@/lib/theme';
import { cn } from '@/lib/utils';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { cssInterop, useColorScheme } from 'nativewind';
import * as React from 'react';
import { BackHandler, View, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// BottomSheetTextInput은 nativewind가 모르는 컴포넌트라 TextInput과 같은 방식으로 className을 style로 바꾼다.
cssInterop(BottomSheetTextInput, {
  className: { target: 'style', nativeStyleToProp: { textAlign: true } },
});

function renderBackdrop(props: BottomSheetBackdropProps) {
  return (
    <BottomSheetBackdrop
      {...props}
      pressBehavior="close"
      appearsOnIndex={0}
      disappearsOnIndex={-1}
    />
  );
}

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /** 닫는 애니메이션이 끝난 뒤(onDismiss) 매번 불린다. 사용자 닫기와 코드 닫기 모두. */
  onClosed?: () => void;
};

/**
 * 화면 아래에서 올라오는 제어형 시트. open이 true면 올리고 false면 내린다.
 * 사용자가 끌어 닫거나 배경·뒤로가기로 닫으면 onOpenChange(false)를 한 번 부른다(코드가 닫은 경우는 부르지 않는다).
 * children은 열린 순간부터 닫는 애니메이션이 끝날 때까지만 그린다.
 */
function Sheet({ open, onOpenChange, children, onClosed }: SheetProps) {
  const ref = React.useRef<BottomSheetModal>(null);
  // 최신 open. 늦게 온 onDismiss가 그 사이 다시 열린 시트를 닫지 않게 한다.
  const openRef = React.useRef(open);
  // 우리 쪽에서 present()한 뒤 아직 onDismiss가 안 온 상태인지.
  const presentedRef = React.useRef(false);
  // open=false로 코드가 dismiss()를 불렀고 그 onDismiss가 아직 안 왔는지. 이 표시가 없는 onDismiss만 사용자 닫기다.
  const closingByCodeRef = React.useRef(false);
  const [shown, setShown] = React.useState(open);
  if (open && !shown) setShown(true);
  const { bottom } = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];

  React.useEffect(() => {
    openRef.current = open;
    if (open) {
      presentedRef.current = true;
      ref.current?.present();
    } else if (presentedRef.current) {
      // 사용자가 이미 닫아 onDismiss가 온 뒤라면 다시 dismiss()하지 않는다(올 onDismiss가 없어 표시가 남는다).
      closingByCodeRef.current = true;
      ref.current?.dismiss();
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    // 라이브러리는 Android 뒤로가기에 시트 대신 화면을 닫을 수 있어 직접 시트를 닫고 이벤트를 소비한다.
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onOpenChange(false);
      return true;
    });
    return () => sub.remove();
  }, [open, onOpenChange]);

  const onDismiss = () => {
    presentedRef.current = false;
    const byCode = closingByCodeRef.current;
    closingByCodeRef.current = false;
    if (byCode && openRef.current) {
      // 코드로 닫는 도중에 부모가 다시 열었다. 닫기가 끝났으니 다시 올리고 내용은 그대로 둔다.
      presentedRef.current = true;
      ref.current?.present();
    } else {
      setShown(false);
      if (!byCode) onOpenChange(false);
    }
    onClosed?.();
  };

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      onDismiss={onDismiss}
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={{ backgroundColor: theme.background }}
      handleIndicatorStyle={{ backgroundColor: theme.mutedForeground }}>
      <BottomSheetView>
        <View className="gap-4 px-6 pt-2" style={{ paddingBottom: bottom + 16 }}>
          {shown ? children : null}
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

type SheetPartProps = { className?: string; children: React.ReactNode };

function SheetHeader({ className, children }: SheetPartProps) {
  return <View className={cn('gap-2', className)}>{children}</View>;
}

function SheetTitle({ className, children }: SheetPartProps) {
  return (
    <Text accessibilityRole="header" className={cn('text-lg font-semibold', className)}>
      {children}
    </Text>
  );
}

function SheetDescription({ className, children }: SheetPartProps) {
  return <Text className={cn('text-sm text-muted-foreground', className)}>{children}</Text>;
}

/** 버튼을 화면 폭 전체로 세로로 쌓는다(주 동작을 위에, 취소를 아래에 둔다). */
function SheetFooter({ className, children }: SheetPartProps) {
  return <View className={cn('w-full flex-col gap-2', className)}>{children}</View>;
}

/** 시트 안의 입력 칸. BottomSheetTextInput이어야 키보드를 따라 시트가 올라간다. */
function SheetInput({ className, ref, ...props }: React.ComponentProps<typeof TextInput>) {
  return (
    <BottomSheetTextInput
      // 라이브러리의 ref 타입은 TextInput | undefined라서 RN TextInput ref와 맞춰 준다.
      ref={ref as React.Ref<TextInput | undefined>}
      className={cn(inputClassName(props.editable), className)}
      {...props}
    />
  );
}

export { Sheet, SheetDescription, SheetFooter, SheetHeader, SheetInput, SheetTitle };
