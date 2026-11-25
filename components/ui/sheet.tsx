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
  /**
   * 내용 전체를 스크롤 영역(BottomSheetScrollView)으로 그린다. 항목 수가 늘어날 수 있는 시트(메뉴, 목록 선택)에 쓴다.
   * 높이는 내용에 맞추되 화면의 80%를 넘으면 그 높이에서 멈추고 스크롤된다.
   * 시트 안에 스크롤 영역을 따로 넣지 않는다: 라이브러리는 BottomSheetView의 레이아웃과
   * 스크롤 영역의 내용 크기를 같은 contentHeight에 써서, 안쪽 스크롤 영역 크기로 시트가 줄어든다.
   */
  scrollable?: boolean;
};

/**
 * 화면 아래에서 올라오는 제어형 시트. open이 true면 올리고 false면 내린다.
 * 사용자가 끌어 닫거나 배경·뒤로가기로 닫으면 onOpenChange(false)를 한 번 부른다(코드가 닫은 경우는 부르지 않는다).
 * children은 열린 순간부터 닫는 애니메이션이 끝날 때까지만 그리고, 닫는 동안에는 눌리지 않는다
 * (라이브러리는 닫는 중에도 터치를 막지 않아 두 번 누르면 같은 동작이 반복된다).
 * 코드 닫기는 open=false로, 사용자 닫기(배경·끌어 닫기)는 닫는 애니메이션 시작(onAnimate → -1)으로 막는다.
 * 높이는 내용을 따른다. 길어질 수 있는 내용은 scrollable로 연다.
 */
function Sheet({ open, onOpenChange, children, onClosed, scrollable }: SheetProps) {
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
  // 닫는 애니메이션이 시작됐는지(onAnimate → -1). 사용자 닫기는 onDismiss 전까지 open이 true라서 이것으로 터치를 막는다.
  const [closing, setClosing] = React.useState(false);
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

  const onAnimate = (_from: number, toIndex: number) => {
    // 끌다가 놓아 제자리로 돌아오면(toIndex >= 0) 다시 누를 수 있다.
    setClosing(toIndex === -1);
  };

  const onDismiss = () => {
    if (!mountedRef.current) return;
    setClosing(false);
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

  const content = (
    <View
      pointerEvents={open && !closing ? 'auto' : 'none'}
      className="gap-4 px-6 pt-2"
      style={{ paddingBottom: bottom + 16 }}>
      {shown ? children : null}
    </View>
  );

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      maxDynamicContentSize={scrollable ? Math.round(height * 0.8) : undefined}
      onDismiss={onDismiss}
      onAnimate={onAnimate}
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={{ backgroundColor: theme.background }}
      handleIndicatorStyle={{ backgroundColor: theme.mutedForeground }}>
      {scrollable ? (
        <BottomSheetScrollView>{content}</BottomSheetScrollView>
      ) : (
        <BottomSheetView>{content}</BottomSheetView>
      )}
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
 * 시트 안의 입력 칸. BottomSheetTextInput이어야 키보드를 따라 시트가 올라간다.
 *
 * 네이티브 입력 칸은 일부러 비제어(defaultValue)로 둔다. iOS에서 BottomSheetModal 포털로 그린
 * TextInput에 value를 내려 주면 글자를 칠 때마다 네이티브 텍스트를 다시 넣으면서 IME가 조합 중인
 * 글자를 확정해 버려, 한글이 "ㅎㅏㅇㅣ"처럼 풀리고 추천 단어도 안 뜬다(SheetInput 자체 상태로 옮겨도 같다).
 * 그래서 value를 제어 입력으로 되돌리지 말 것. 호출부는 그대로 value/onChangeText를 넘기고, 여기서는
 * 스스로 낸 적 없는 value가 바깥에서 들어올 때만 key를 바꿔 새 defaultValue로 다시 마운트한다
 * (늦게 도착한 자기 글자의 메아리로 다시 마운트하면 조합 중인 글자가 사라진다).
 * 호출부는 onChangeText로 받은 글자를 그대로 value로 돌려줘야 한다. 다듬거나(trim·대문자·걸러내기) 바꿔서
 * 돌려주면 매번 "낸 적 없는 값"이 되어 글자마다 다시 마운트되고 조합·포커스가 깨진다. 다듬기는 저장할 때 한다.
 */
function SheetInput({
  className,
  ref,
  value,
  defaultValue,
  onChangeText,
  ...props
}: React.ComponentProps<typeof TextInput>) {
  // seen: 네이티브 칸이 들고 있었던 글자를 순서대로 모은 것(마운트 값, 그 뒤 onChangeText로 낸 글자들).
  // 포털을 거친 value는 한 렌더 늦게 도착하므로, 이미 지나간 자기 글자의 메아리일 수 있다.
  const [native, setNative] = React.useState(() => {
    const text = value ?? defaultValue;
    return { key: 0, initial: text, seen: [text] };
  });
  if (value !== undefined) {
    const at = native.seen.indexOf(value);
    if (at === -1) {
      // 한 번도 낸 적 없는 값 = 바깥 변경(초기화·정리 등). 다시 마운트해서 반영한다.
      // 렌더 중 상태 갱신은 이 컴포넌트 것만 바꾸는 파생 상태 패턴이다.
      setNative({ key: native.key + 1, initial: value, seen: [value] });
    } else if (at > 0) {
      // 호출부가 여기까지 따라왔으니 그 앞의 글자는 더 이상 메아리로 오지 않는다. 지워야 나중에
      // 같은 글자로 바깥에서 되돌릴 때(예: 비우기) 그것을 메아리로 오인하지 않는다.
      setNative({ ...native, seen: native.seen.slice(at) });
    }
  }

  const handleChangeText = React.useCallback(
    (text: string) => {
      // 비제어로 쓰면(value 없음) 메아리가 올 일이 없으니 쌓지 않는다.
      if (value !== undefined) setNative((prev) => ({ ...prev, seen: [...prev.seen, text] }));
      onChangeText?.(text);
    },
    [onChangeText, value]
  );

  return (
    <BottomSheetTextInput
      key={native.key}
      // 라이브러리의 ref 타입은 TextInput | undefined라서 RN TextInput ref와 맞춰 준다.
      ref={ref as React.Ref<TextInput | undefined>}
      className={cn(inputClassName(props.editable), className)}
      {...props}
      defaultValue={native.initial}
      onChangeText={handleChangeText}
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
      <Sheet open={open} onOpenChange={setOpen} onClosed={onClosed} scrollable>
        <View className="-mx-2">
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
        </View>
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
  SheetTitle,
  useLastWhileOpen,
};
export type { MenuSheetItem };
