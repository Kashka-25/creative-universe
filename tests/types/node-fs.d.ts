// The Node APIs the tests use. The project has no @types/node; this keeps the tests type-checked
// (tsconfig.test.json) without adding a dependency.
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  export function existsSync(path: string | URL): boolean;
}
