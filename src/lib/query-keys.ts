export const qk = {
  onboarding: (userId: string) => ['onboarding', userId] as const,
  families: () => ['families'] as const,
  lists: (familyId: string) => ['lists', familyId] as const,
  items: (listId: string) => ['items', listId] as const,
  locations: (listId: string) => ['locations', listId] as const,
  allLocations: () => ['allLocations'] as const,
  members: (familyId: string) => ['members', familyId] as const,
};

/** 모든 mutation 키는 ['m', …] 로 시작한다(대기 중 mutation 개수를 한 번에 세기 위해). */
export const mk = {
  all: ['m'] as const,
  addItem: ['m', 'items', 'add'] as const,
  toggleItem: ['m', 'items', 'toggle'] as const,
  updateItem: ['m', 'items', 'update'] as const,
  deleteItems: ['m', 'items', 'delete'] as const,
  clearDone: ['m', 'items', 'clear-done'] as const,
  clearList: ['m', 'items', 'clear-list'] as const,
  moveItems: ['m', 'items', 'move'] as const,
  createList: ['m', 'lists', 'create'] as const,
  renameList: ['m', 'lists', 'rename'] as const,
  deleteList: ['m', 'lists', 'delete'] as const,
  reorderLists: ['m', 'lists', 'reorder'] as const,
  addLocation: ['m', 'locations', 'add'] as const,
  deleteLocation: ['m', 'locations', 'delete'] as const,
};
