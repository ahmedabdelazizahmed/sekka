declare module '*/mock-core.mjs' {
  export function createMock(db: unknown): Promise<{
    db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>; exec: (sql: string) => Promise<unknown> }
    admin: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>
    handle: (method: string, url: string, headers: Record<string, string>, body: string) => Promise<{ status: number; json: unknown; range?: string }>
  }>
}
