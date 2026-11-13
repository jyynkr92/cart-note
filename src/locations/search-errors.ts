/** 장소 검색 사용자별 할당량 초과(Edge Function 429). */
export class SearchRateLimitedError extends Error {
  constructor() {
    super('rate_limited');
    this.name = 'SearchRateLimitedError';
  }
}
