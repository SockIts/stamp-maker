export type SharedStampRecord = {
  id: string
  src: string
  createdAt: number
  wallColor?: string
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSharedDatabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

const authHeaders = () => ({
  apikey: SUPABASE_ANON_KEY ?? '',
  Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ''}`,
})

const dataUrlToBlob = (dataUrl: string) => {
  const [meta, content] = dataUrl.split(',')
  if (!meta || !content) throw new Error('Invalid data URL')
  const mimeMatch = meta.match(/data:(.*?);base64/)
  const mime = mimeMatch?.[1] ?? 'image/png'
  const binary = atob(content)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

export const fetchSharedStamps = async (limit = 200): Promise<SharedStampRecord[]> => {
  if (!isSharedDatabaseConfigured) return []

  const url = new URL(`${SUPABASE_URL}/rest/v1/stamps`)
  url.searchParams.set('select', 'id,src,created_at,wall_color')
  url.searchParams.set('order', 'created_at.desc')
  url.searchParams.set('limit', String(limit))

  const response = await fetch(url.toString(), {
    headers: {
      ...authHeaders(),
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch shared stamps: ${response.status}`)
  }

  const rows = (await response.json()) as Array<{
    id: string
    src: string
    created_at: string
    wall_color?: string | null
  }>

  return rows.map((row) => ({
    id: row.id,
    src: row.src,
    createdAt: Date.parse(row.created_at),
    wallColor: row.wall_color ?? undefined,
  }))
}

export const publishSharedStamp = async (dataUrl: string, wallColor?: string) => {
  if (!isSharedDatabaseConfigured) {
    throw new Error('Shared database is not configured')
  }

  const id = crypto.randomUUID()
  const blob = dataUrlToBlob(dataUrl)
  const objectPath = `${id}.png`

  const uploadResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/stamps/${objectPath}`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'image/png',
      'x-upsert': 'false',
    },
    body: blob,
  })

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload stamp image: ${uploadResponse.status}`)
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/stamps/${objectPath}`
  const createdAt = new Date().toISOString()

  const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/stamps`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify([
      {
        id,
        src: publicUrl,
        created_at: createdAt,
        wall_color: wallColor ?? null,
      },
    ]),
  })

  if (!insertResponse.ok) {
    throw new Error(`Failed to save stamp metadata: ${insertResponse.status}`)
  }

  return {
    id,
    src: publicUrl,
    createdAt: Date.parse(createdAt),
    wallColor,
  } satisfies SharedStampRecord
}
