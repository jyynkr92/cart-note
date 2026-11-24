import { Button } from '@/components/ui/button';
import { inputClassName } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { THEME } from '@/lib/theme';
import { cn } from '@/lib/utils';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { cssInterop, useColorScheme } from 'nativewind';
import * as React from 'react';
import { BackHandler, Pressable, useWindowDimensions, View, type TextInput } from 'react-native';
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
  /**
   * 닫는 애니메이션이 끝나 시트가 닫힌 채로 남을 때(onDismiss) 불린다. 사용자 닫기와 코드 닫기 모두.
   * 코드로 닫는 도중에 부모가 다시 열어 시트를 다시 올리는 경우에는 부르지 않는다.
   */
  onClosed?: () => void;
};

/**
 * 화면 아래에서 올라오는 제어형 시트. open이 true면 올리고 false면 내린다.
 * 사용자가 끌어 닫거나 배경·뒤로가기로 닫으면 onOpenChange(false)를 한 번 부른다(코드가 닫은 경우는 부르지 않는다).
 * children은 열린 순간부터 닫는 애니메이션이 끝날 때까지만 그리고, 닫는 동안에는 눌리지 않는다
 * (라이브러리는 닫는 중에도 터치를 막지 않아 두 번 누르면 같은 동작이 반복된다).
 * 높이는 내용을 따르되 화면 높이의 80%를 넘지 않는다. 긴 내용은 SheetScrollArea에 넣는다.
 */
function Sheet({ open, onOpenChange, children, onClosed }: SheetProps) {
  const ref = React.useRef<BottomSheetModal>(null);
  // 최신 open. 늦게 온 onDismiss가 그 사이 다시 열린 시트를 닫지 않게 한다.
  const openRef = React.useRef(open);
  // 우리 쪽에서 present()한 뒤 아직 onDismiss가 안 온 상태인지.
  const presentedRef = React.useRef(false);
  // open=false로 코드가 dismiss()를 불렀고 그 onDismiss가 아직 안 왔는지. 이 표시가 없는 onDismiss만 사용자 닫기다.
  const closingByCodeRef = React.useRef(false);
  // 언마운트된 뒤 늦게 오는 onDismiss(라이브러리는 올라온 모달이 언마운트되면 닫고 onDismiss를 부른다)는 아무것도 부르지 않는다.
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [shown, setShown] = React.useState(open);
  if (open && !shown) setShown(true);
  const { bottom } = useSafeAreaInsets();
  const { height } = useWindowDimensions();
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
    if (!mountedRef.current) return;
    presentedRef.current = false;
    const byCode = closingByCodeRef.current;
    closingByCodeRef.current = false;
    if (byCode && openRef.current) {
      // 코드로 닫는 도중에 부모가 다시 열었다. 닫기가 끝났으니 다시 올리고 내용은 그대로 둔다.
      // 닫힌 채로 남은 게 아니므로 onClosed는 부르지 않는다.
      presentedRef.current = true;
      ref.current?.present();
      return;
    }
    setShown(false);
    // 부모가 그 사이 open=false로 바꿨다면 이미 닫힌 것으로 알고 있으니 다시 알리지 않는다.
    if (!byCode && openRef.current) onOpenChange(false);
    onClosed?.();
  };

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      maxDynamicContentSize={Math.round(height * 0.8)}
      onDismiss={onDismiss}
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={{ backgroundColor: theme.background }}
      handleIndicatorStyle={{ backgroundColor: theme.mutedForeground }}>
      <BottomSheetView>
        <View
          pointerEvents={open ? 'auto' : 'none'}
          className="gap-4 px-6 pt-2"
          style={{ paddingBottom: bottom + 16 }}>
          {shown ? children : null}
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

/**
 * 시트가 열려 있으면 value를, 닫혀 있으면 마지막으로 열려 있던 때의 value를 돌려준다.
 * 시트를 닫는 같은 렌더에서 내용의 근거(편집 대상, 개수, 모드)가 바뀌어도
 * 닫는 애니메이션 동안 닫기 전 내용을 보이게 한다(라이브러리는 닫는 중에 내용 갱신을 멈춘다).
 */
function useLastWhileOpen<T>(value: T, open: boolean): T {
  const [last, setLast] = React.useState(value);
  if (open && !Object.is(last, value)) setLast(value);
  return open ? value : last;
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

/**
 * 시트 안에서 길어질 수 있는 목록(메뉴 항목, 목록 선택 버튼)을 담는 스크롤 영역.
 * 화면 높이의 절반까지만 차지해 아래 버튼(취소 등)이 늘 보이게 한다.
 */
function SheetScrollArea({ className, children }: SheetPartProps) {
  const { height } = useWindowDimensions();
  return (
    <BottomSheetScrollView style={{ maxHeight: Math.round(height * 0.5) }}>
      <View className={className}>{children}</View>
    </BottomSheetScrollView>
  );
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

type ConfirmSheetProps = {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 확인/취소 시트. 확인은 onConfirm만 부르고, 닫는 것은 부모가 open=false로 한다.
 * 부모는 onConfirm에서 반드시 open=false로 바꿔야 한다.
 * 취소 버튼·끌어 닫기·배경·뒤로가기는 onCancel이다.
 * 확인이나 취소를 한 번 누르면 다시 열릴 때까지 두 버튼과 닫기는 아무것도 부르지 않는다
 * (두 번 눌러 동작이 반복되거나, 닫히는 동안 다른 답이 눌리지 않게).
 */
function ConfirmSheet({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '취소',
  destructive,
  confirmDisabled,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  // 이번에 열린 뒤 확인이나 취소로 이미 답했는지.
  const answeredRef = React.useRef(false);
  React.useEffect(() => {
    if (open) answeredRef.current = false;
  }, [open]);

  const answer = (run: () => void) => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    run();
  };

  const onOpenChange = (next: boolean) => {
    if (!next) answer(onCancel);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
        {description ? <SheetDescription>{description}</SheetDescription> : null}
      </SheetHeader>
      <SheetFooter>
        <Button
          variant={destructive ? 'destructive' : 'default'}
          disabled={confirmDisabled}
          onPress={() => answer(onConfirm)}>
          <Text>{confirmLabel}</Text>
        </Button>
        <Button variant="outline" onPress={() => answer(onCancel)}>
          <Text>{cancelLabel}</Text>
        </Button>
      </SheetFooter>
    </Sheet>
  );
}

type MenuSheetItem =
  | {
      label: string;
      onPress: () => void;
      disabled?: boolean;
      destructive?: boolean;
      selected?: boolean;
    }
  | 'separator';

type MenuSheetProps = {
  trigger: (open: () => void) => React.ReactNode;
  items: MenuSheetItem[];
};

/**
 * 트리거로 여는 메뉴 시트. 항목을 누르면 메뉴를 닫고, 그 항목의 onPress는 닫는 애니메이션이 끝난 뒤에 부른다
 * (항목이 다른 시트를 열어도 두 시트가 동시에 움직이지 않게). 맨 아래 취소 행은 닫기만 한다.
 * 닫기가 끝나기 전에 메뉴를 다시 열면 앞서 누른 항목은 취소된다.
 */
function MenuSheet({ trigger, items }: MenuSheetProps) {
  const [open, setOpen] = React.useState(false);
  // 닫힌 뒤 부를 항목. 닫히기 전에 여러 번 눌리면 마지막 것만 한 번 부른다.
  const pendingRef = React.useRef<(() => void) | null>(null);
  const show = React.useCallback(() => setOpen(true), []);
  React.useEffect(() => {
    // 닫히는 도중에 다시 열면 그 항목은 부르지 않는다(다시 올라온 메뉴 위에 항목의 시트가 겹치지 않게).
    if (open) pendingRef.current = null;
  }, [open]);

  const onClosed = () => {
    const run = pendingRef.current;
    pendingRef.current = null;
    run?.();
  };

  return (
    <>
      {trigger(show)}
      <Sheet open={open} onOpenChange={setOpen} onClosed={onClosed}>
        <SheetScrollArea className="-mx-2">
          {items.map((item, i) =>
            item === 'separator' ? (
              <View key={`separator-${i}`} className="mx-2 my-1 h-px bg-border" />
            ) : (
              <Pressable
                key={`${item.label}-${i}`}
                accessibilityRole="menuitem"
                accessibilityState={{ disabled: !!item.disabled, selected: !!item.selected }}
                disabled={item.disabled}
                onPress={() => {
                  pendingRef.current = item.onPress;
                  setOpen(false);
                }}
                className={cn(
                  'h-12 flex-row items-center rounded-md px-2 active:bg-accent',
                  item.disabled && 'opacity-50'
                )}>
                <Text
                  className={cn(
                    item.selected && 'font-semibold',
                    item.destructive && 'text-destructive'
                  )}>
                  {item.label}
                </Text>
              </Pressable>
            )
          )}
        </SheetScrollArea>
        <Button
          variant="outline"
          onPress={() => {
            pendingRef.current = null;
            setOpen(false);
          }}>
          <Text>취소</Text>
        </Button>
      </Sheet>
    </>
  );
}

export {
  ConfirmSheet,
  MenuSheet,
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetInput,
  SheetScrollArea,
  SheetTitle,
  useLastWhileOpen,
};
export type { MenuSheetItem };
