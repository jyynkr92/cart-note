// 커스텀 진입점: Android가 앱이 종료된 상태에서 headless로 다시 띄울 때 라우트 모듈(app/_layout.tsx)은
// 평가되지 않을 수 있으므로, 백그라운드 지오펜스 작업 정의를 라우터보다 먼저 여기서 등록한다.
import './src/geofence/geofence-task';
import 'expo-router/entry';
