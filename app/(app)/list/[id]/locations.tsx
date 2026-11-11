import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/src/groups/use-groups';
import { normalizeName } from '@/src/lib/text';
import { useTopInset } from '@/src/lib/use-top-inset';
import { useLists } from '@/src/lists/use-lists';
import { searchPlaces, type ListLocation, type Place } from '@/src/locations/location-api';
import { useAddLocation, useDeleteLocation, useLocations } from '@/src/locations/use-locations';

export default function Locations() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const paddingTop = useTopInset();
  const { family, loading } = useCurrentGroup();
  const familyId = family?.id ?? null;
  const lists = useLists(familyId);
  const list = lists.data?.find((l) => l.id === id);
  const locations = useLocations(list?.kind === 'store' ? list.id : null);
  const addLocation = useAddLocation();
  const deleteLocation = useDeleteLocation();

  const [text, setText] = useState('');
  const search = useMutation<Place[], Error, string>({
    mutationFn: (q) => searchPlaces(q),
    // 오프라인에서 멈추지 않고 실패해 재시도 안내를 보여 준다(큐에도 쌓이지 않는다).
    networkMode: 'always',
  });

  const wrap = (children: React.ReactNode) => (
    <View className="flex-1 bg-background px-4" style={{ paddingTop }}>
      {children}
    </View>
  );

  if (!family || (lists.isPending && !lists.isError)) {
    return !family && !loading ? (
      <View className="flex-1 bg-background" />
    ) : (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  if (!list || list.kind !== 'store') {
    return wrap(
      <View className="flex-1 items-center justify-center gap-4">
        <Text>목록을 찾을 수 없어요</Text>
        <Button onPress={() => router.replace('/')}>
          <Text>홈으로</Text>
        </Button>
      </View>
    );
  }

  const listId = list.id;
  const registered: ListLocation[] = locations.data ?? [];
  const registeredIds = new Set(registered.map((l) => l.kakao_place_id));

  function runSearch() {
    const q = normalizeName(text);
    if (q) search.mutate(q);
  }

  function add(place: Place) {
    if (!familyId) return;
    addLocation.mutate({ listId, familyId, place });
  }

  return wrap(
    <>
      <View className="flex-row items-center gap-1 pb-3">
        <Button variant="ghost" size="icon" accessibilityLabel="뒤로" onPress={() => router.back()}>
          <Text>‹</Text>
        </Button>
        <Text className="flex-1 text-xl font-bold" numberOfLines={1}>
          {`${list.name} 지점 관리`}
        </Text>
      </View>

      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Input
            placeholder="지점 검색 (예: 코스트코 양재)"
            value={text}
            onChangeText={setText}
            onSubmitEditing={runSearch}
            returnKeyType="search"
          />
        </View>
        <Button accessibilityLabel="검색" onPress={runSearch} disabled={search.isPending}>
          <Text>검색</Text>
        </Button>
      </View>

      <ScrollView className="mt-2" contentContainerClassName="pb-6" keyboardShouldPersistTaps="handled">
        {search.isPending ? (
          <View className="items-center py-6">
            <ActivityIndicator />
          </View>
        ) : search.isError ? (
          <View className="items-center gap-4 py-6">
            <Text>검색에 실패했어요. 다시 시도해 주세요</Text>
            <Button onPress={() => search.variables && search.mutate(search.variables)}>
              <Text>다시 시도</Text>
            </Button>
          </View>
        ) : search.data ? (
          search.data.length === 0 ? (
            <Text className="py-6 text-center text-muted-foreground">검색 결과가 없어요</Text>
          ) : (
            <View>
              {search.data.map((p) => {
                const added = registeredIds.has(p.kakao_place_id);
                return (
                  <Pressable
                    key={p.kakao_place_id}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.place_name} 추가`}
                    accessibilityState={{ disabled: added }}
                    disabled={added}
                    onPress={() => add(p)}
                    className="px-4 py-3">
                    <Text className="text-base">{p.place_name}</Text>
                    <Text className="text-sm text-muted-foreground">
                      {added ? `등록됨 · ${p.address}` : p.address}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )
        ) : null}

        <Text className="px-4 pb-1 pt-4 text-sm font-medium text-muted-foreground">
          {`등록된 지점 (${registered.length})`}
        </Text>
        {registered.length === 0 ? (
          <Text className="px-4 py-2 text-muted-foreground">등록된 지점이 없어요</Text>
        ) : (
          registered.map((l) => (
            <ReanimatedSwipeable
              key={l.id}
              overshootRight={false}
              renderRightActions={() => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="삭제"
                  onPress={() => deleteLocation.mutate({ id: l.id, listId, familyId: l.family_id })}
                  className="w-20 items-center justify-center bg-destructive">
                  <Text className="text-sm font-medium text-white">삭제</Text>
                </Pressable>
              )}>
              <View className="bg-background px-4 py-3">
                <Text testID="location-name" className="text-base">
                  {l.place_name}
                </Text>
                {l.address ? (
                  <Text className="text-sm text-muted-foreground">{l.address}</Text>
                ) : null}
              </View>
            </ReanimatedSwipeable>
          ))
        )}
      </ScrollView>
    </>
  );
}
