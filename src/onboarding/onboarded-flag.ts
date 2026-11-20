import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 온보딩을 마친(ready까지 간) 사용자 id. 온보딩 쿼리는 영속화하지 않으므로, 오프라인 콜드 스타트에서
 * 영속화된 그룹 캐시와 이 표시가 모두 있으면 홈을 보여 준다. 값이 사용자 id라 다른 계정에는 적용되지 않는다.
 */
export const ONBOARDED_KEY = 'cart-note-onboarded';

export async function isOnboarded(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDED_KEY)) === userId;
  } catch {
    return false;
  }
}

export async function markOnboarded(userId: string): Promise<void> {
  await AsyncStorage.setItem(ONBOARDED_KEY, userId).catch(() => {});
}

/** 로그아웃 시 다른 사용자별 상태와 함께 지운다. 절대 던지지 않는다. */
export async function clearOnboarded(): Promise<void> {
  await AsyncStorage.removeItem(ONBOARDED_KEY).catch(() => {});
}
