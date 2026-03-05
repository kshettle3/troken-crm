import { supabase } from './supabase'

export const db = {
  async query(sql: string, params?: any[]): Promise<any[]> {
    let finalSql = sql
    if (params && params.length > 0) {
      params.forEach((p, i) => {
        const val = p === null ? 'NULL'
          : typeof p === 'number' ? String(p)
          : typeof p === 'boolean' ? String(p)
          : `'${String(p).replace(/'/g, "''")}'`
        finalSql = finalSql.replace(`$${i + 1}`, val)
      })
    }
    const { data, error } = await supabase.rpc('exec_sql', { query: finalSql })
    if (error) throw error
    return data ?? []
  },
  async execute(sql: string, params?: any[]): Promise<void> {
    await this.query(sql, params)
  }
}
