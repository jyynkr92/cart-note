-- /review A4, A13: 좌표/반경 범위와 텍스트 길이 CHECK.
-- 클라이언트 검증과 별개로 서버가 마지막 방어선이 된다(직접 REST 호출로 이상한 값이 들어오지 못하게).
-- ADD CONSTRAINT는 기존 행도 검사한다. 앱은 반경 300m, 카카오 좌표, 짧은 이름만 넣어 왔으므로 위반 행이 없어야 한다.

-- A4: 좌표/반경. Postgres에서 NaN은 모든 수보다 크고 Infinity도 범위를 벗어나므로 between이 둘 다 거부한다.
alter table public.list_locations
  add constraint list_locations_lat_range check (lat between -90 and 90),
  add constraint list_locations_lng_range check (lng between -180 and 180),
  add constraint list_locations_radius_range check (radius_m between 50 and 5000);

-- A13: 텍스트 길이(문자 수). 클라이언트 입력 maxLength와 같은 값이다(src/lib/text.ts MAX_LENGTH).
alter table public.profiles
  add constraint profiles_display_name_length check (char_length(display_name) <= 50);
alter table public.families
  add constraint families_name_length check (char_length(name) <= 50);
alter table public.lists
  add constraint lists_name_length check (char_length(name) <= 50);
alter table public.items
  add constraint items_name_length check (char_length(name) <= 200),
  add constraint items_note_length check (char_length(note) <= 1000);
alter table public.list_locations
  add constraint list_locations_place_name_length check (char_length(place_name) <= 200),
  add constraint list_locations_address_length check (char_length(address) <= 300);
