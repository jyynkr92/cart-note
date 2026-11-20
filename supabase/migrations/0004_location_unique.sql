-- 같은 목록에 같은 카카오 장소를 두 번 등록하지 못하게 한다(kakao_place_id 없는 수동 지점은 제외).
create unique index list_locations_list_place_uniq
  on public.list_locations (list_id, kakao_place_id)
  where kakao_place_id is not null;
