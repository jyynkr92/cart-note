/**
 * 테스트에서 소스 파일을 읽기 위한 최소 fs/path 타입.
 * 앱 tsconfig에는 Node 타입(@types/node)이 없으므로 `import fs from 'fs'`는 typecheck를 깨뜨린다.
 */
type Dirent = { name: string; isDirectory(): boolean; isFile(): boolean };

export const fs: {
  readFileSync(path: string, encoding: 'utf8'): string;
  existsSync(path: string): boolean;
  readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('fs');

export const path: {
  join(...parts: string[]): string;
  sep: string;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('path');
