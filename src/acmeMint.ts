import { Psbt } from 'bitcoinjs-lib'

export type AcmeStorageType = 'utxo' | 'opreturn' | 'witness' | 'arweave'
export type AcmeMintStatus = 'idle' | 'composing' | 'signing' | 'broadcasting' | 'success' | 'error'

export type AcmeWalletState = {
  connected: boolean
  connecting: boolean
  address: string | null
  publicKey: string | null
  network: string | null
  balance: number | null
  error: string | null
}

export type AcmeMintForm = {
  assetName: string
  storageType: AcmeStorageType
  artistName: string
  collectionName: string
  additionalAxons: Array<{ id: string; rel: string; ref: string }>
  tags: string
  description: string
  feeRate: number
  locked: boolean
}

type UniSatBalance = {
  total: number
}

type UniSatApi = {
  requestAccounts: () => Promise<string[]>
  getPublicKey: () => Promise<string>
  getNetwork: () => Promise<string>
  getBalance: () => Promise<UniSatBalance>
  signPsbt: (
    psbtHex: string,
    options?: {
      autoFinalized?: boolean
      toSignInputs?: Array<{
        index: number
        address?: string
        publicKey?: string
        sighashTypes?: number[]
        disableTweakSigner?: boolean
      }>
    },
  ) => Promise<string>
}

declare global {
  interface Window {
    unisat?: UniSatApi
  }
}

type ApiResponse<T> = {
  result?: T
  data?: T
  error?: string
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const ACME_PUBLIC_ORIGIN =
  (import.meta.env.VITE_ACME_PUBLIC_ORIGIN as string | undefined)?.trim() || 'https://testnet.acme.pics'

const ACME_API_BASE_URL =
  (import.meta.env.VITE_ACME_API_BASE_URL as string | undefined)?.trim() ||
  (import.meta.env.DEV ? '' : ACME_PUBLIC_ORIGIN)

const resolveAcmeUrl = (path: string) => {
  const baseUrl = trimTrailingSlash(ACME_API_BASE_URL)
  return baseUrl ? `${baseUrl}${path}` : path
}

type BackendUtxo = {
  txid?: string
  tx_hash?: string
  vout?: number
  tx_pos?: number
  value?: number | string
  amount?: number | string
  scriptPubKey?: string
  script_pubkey?: string
  address?: string
  confirmations?: number
  height?: number
}

type Utxo = {
  txid: string
  vout: number
  value: number
  scriptPubKey: string
}

type UnifiedArtResult = {
  psbt?: string
  commit_txid?: string
  commit_vout?: number
  reveal_commit_value_sats: number
  reveal_commit_script_pubkey_hex: string
  reveal_witness_script_hex: string
  reveal_secret_key_hex: string
  reveal_internal_key_hex: string
  reveal_merkle_root_hex?: string
  reveal_destination_address: string
  reveal_postage_sats: number
  content_hash: string
  opreturn_script_hex?: string
}

const jsonFetch = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const body = await response.text()
  const data = (body ? tryParseJson<ApiResponse<T> | T>(body) : {}) as ApiResponse<T> | T
  if (!response.ok) {
    const message = typeof data === 'object' && data && 'error' in data ? String(data.error) : ''
    const fallback = response.status === 502
      ? 'ACME testnet gateway returned 502 Bad Gateway'
      : response.statusText
    throw new Error(message || fallback || `Request failed with ${response.status}`)
  }
  if (typeof data === 'object' && data && 'error' in data && data.error) {
    throw new Error(data.error)
  }
  if (typeof data === 'object' && data && 'result' in data && data.result !== undefined) return data.result as T
  if (typeof data === 'object' && data && 'data' in data && data.data !== undefined) return data.data as T
  return data as T
}

const tryParseJson = <T,>(body: string): T | Record<string, never> => {
  try {
    return JSON.parse(body) as T
  } catch {
    return {}
  }
}

const base64ToHex = (base64: string) => {
  const binary = atob(base64)
  let hex = ''
  for (let i = 0; i < binary.length; i += 1) {
    hex += binary.charCodeAt(i).toString(16).padStart(2, '0')
  }
  return hex
}

const normalizeNetwork = (network: string) => {
  if (network === 'livenet') return 'mainnet'
  if (network === 'testnet4') return 'testnet'
  return network || 'testnet'
}

const normalizeValue = (utxo: BackendUtxo) => {
  if (utxo.value !== undefined) return Number(utxo.value)
  if (utxo.amount !== undefined) return Math.round(Number(utxo.amount) * 100_000_000)
  return 0
}

const normalizeUtxo = (utxo: BackendUtxo): Utxo | null => {
  const txid = utxo.txid ?? utxo.tx_hash
  const vout = utxo.vout ?? utxo.tx_pos
  const value = normalizeValue(utxo)
  const scriptPubKey = utxo.scriptPubKey ?? utxo.script_pubkey ?? ''

  if (!txid || vout === undefined || !Number.isFinite(value) || value <= 0 || !scriptPubKey) {
    return null
  }

  return { txid, vout, value, scriptPubKey }
}

export const connectUniSat = async (): Promise<AcmeWalletState> => {
  if (!window.unisat) {
    throw new Error('UniSat wallet is not installed.')
  }

  const accounts = await window.unisat.requestAccounts()
  const address = accounts[0]
  if (!address) throw new Error('No UniSat account selected.')

  const [publicKey, network, balance] = await Promise.all([
    window.unisat.getPublicKey(),
    window.unisat.getNetwork(),
    window.unisat.getBalance().catch(() => ({ total: 0 })),
  ])

  return {
    connected: true,
    connecting: false,
    address,
    publicKey,
    network: normalizeNetwork(network),
    balance: balance.total,
    error: null,
  }
}

export const dataUrlToBase64 = (dataUrl: string) => {
  const commaIndex = dataUrl.indexOf(',')
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl
}

export const validateAcmeAssetName = (name: string) => /^[A-Z][A-Z0-9]{2,15}$/.test(name)

export const normalizeAcmeAssetRef = (ref: string) => ref.trim().toUpperCase()

export const validateAcmeAssetRef = (ref: string) => {
  const normalized = normalizeAcmeAssetRef(ref)
  if (!normalized) return true
  if (normalized.startsWith('/')) return true
  return /^[A-Z][A-Z0-9.]*$/.test(normalized) && normalized.length >= 4
}

export const normalizeAcmeAssetRefList = (refs: string) =>
  refs
    .split(',')
    .map(normalizeAcmeAssetRef)
    .filter(Boolean)

export const validateAcmeMintForm = (form: AcmeMintForm): string | null => {
  const assetName = normalizeAcmeAssetRef(form.assetName)
  const artistName = normalizeAcmeAssetRef(form.artistName)
  const collectionNames = normalizeAcmeAssetRefList(form.collectionName)
  const invalidAxon = form.additionalAxons.find((axon) => axon.ref.trim() && (!axon.rel.trim() || !validateAcmeAssetRef(axon.ref)))

  if (!validateAcmeAssetName(assetName)) {
    return 'Asset name must be 3-16 uppercase letters and numbers, starting with a letter.'
  }

  if (artistName && !validateAcmeAssetRef(artistName)) {
    return 'Artist must be a valid ACME asset reference.'
  }

  if (!collectionNames.length) {
    return 'At least one collection is required.'
  }

  if (collectionNames.some((collectionName) => !validateAcmeAssetRef(collectionName))) {
    return 'Collections must be valid ACME asset references separated by commas.'
  }

  if (invalidAxon) {
    return 'Additional relationships need a relationship type and valid ACME asset reference.'
  }

  if (!Number.isFinite(form.feeRate) || form.feeRate < 1) {
    return 'Fee rate must be at least 1 sat/vB.'
  }

  return null
}

export const buildStampMetadata = (form: AcmeMintForm) => {
  const artistName = normalizeAcmeAssetRef(form.artistName)
  const collectionNames = normalizeAcmeAssetRefList(form.collectionName)
  const additionalAxons = form.additionalAxons
    .map((axon) => ({ rel: axon.rel.trim().toLowerCase(), ref: normalizeAcmeAssetRef(axon.ref) }))
    .filter((axon) => axon.rel && axon.ref)
  const attributes = [
    artistName ? { trait_type: 'Artist', value: artistName } : null,
    collectionNames.length ? { trait_type: 'Collection', value: collectionNames.join(', ') } : null,
    { trait_type: 'Tool', value: 'Stamp Maker' },
  ].filter((item): item is { trait_type: string; value: string } => Boolean(item))

  return {
    name: normalizeAcmeAssetRef(form.assetName),
    description: form.description.trim() || 'Created with Stamp Maker.',
    attributes,
    provenance: {
      creator: artistName || undefined,
      tool: 'stamp-maker',
      created_at: new Date().toISOString(),
    },
    cortex: {
      v: 1,
      type: 'stamp',
      axons: [
        artistName ? { ref: artistName, rel: 'artist' } : null,
        ...collectionNames.map((collectionName) => ({ ref: collectionName, rel: 'collection' })),
        ...additionalAxons,
        ...form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
          .map((tag) => ({ ref: tag, rel: 'tag' })),
      ].filter((item): item is { ref: string; rel: string } => Boolean(item)),
    },
  }
}

export const mintStampOnAcme = async ({
  form,
  imageDataUrl,
  wallet,
}: {
  form: AcmeMintForm
  imageDataUrl: string
  wallet: AcmeWalletState
}) => {
  if (!wallet.address) throw new Error('Connect UniSat before minting.')
  if (!window.unisat) throw new Error('UniSat wallet is not available.')

  const utxos = await jsonFetch<BackendUtxo[]>(
    resolveAcmeUrl(`/admin/bitcoin/addresses/${encodeURIComponent(wallet.address)}/utxos`),
  )
  const normalizedUtxos = utxos.map(normalizeUtxo).filter((utxo): utxo is Utxo => utxo !== null)
  if (!normalizedUtxos.length) throw new Error('No spendable UTXOs found for this wallet.')

  const composeResult = await jsonFetch<UnifiedArtResult>(resolveAcmeUrl('/api/compose'), {
    method: 'POST',
    body: JSON.stringify({
      type: 'unified_art',
      source: wallet.address,
      asset: form.assetName.trim().toUpperCase(),
      quantity: 1,
      divisible: false,
      lock: form.locked,
      storage_type: form.storageType,
      art_base64: dataUrlToBase64(imageDataUrl),
      art_mime_type: 'image/png',
      metadata: buildStampMetadata(form),
      fee_rate_sat_vb: form.feeRate,
      destination: wallet.address,
      build_transaction: true,
      utxos: normalizedUtxos.map((utxo) => ({
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        script_pubkey: utxo.scriptPubKey,
      })),
      fee_rate: form.feeRate,
    }),
  })

  if (!composeResult.psbt || !composeResult.commit_txid || composeResult.commit_vout === undefined) {
    throw new Error('ACME did not return a signable PSBT.')
  }

  await jsonFetch(resolveAcmeUrl('/api/compose'), {
    method: 'POST',
    body: JSON.stringify({
      type: 'witness_art_finalize',
      commit_txid: composeResult.commit_txid,
      commit_vout: composeResult.commit_vout,
      commit_value_sats: composeResult.reveal_commit_value_sats,
      commit_output_script_hex: composeResult.reveal_commit_script_pubkey_hex,
      witness_script_hex: composeResult.reveal_witness_script_hex,
      reveal_secret_key_hex: composeResult.reveal_secret_key_hex,
      internal_key_hex: composeResult.reveal_internal_key_hex,
      merkle_root_hex: composeResult.reveal_merkle_root_hex,
      destination: composeResult.reveal_destination_address,
      postage_sats: composeResult.reveal_postage_sats,
      content_hash: composeResult.content_hash,
      asset_name: form.assetName.trim().toUpperCase(),
      source_address: wallet.address,
      opreturn_script_hex: composeResult.opreturn_script_hex,
    }),
  })

  let signedPsbt: string
  try {
    signedPsbt = await window.unisat.signPsbt(base64ToHex(composeResult.psbt), { autoFinalized: true })
  } catch (error) {
    await jsonFetch(resolveAcmeUrl('/api/compose'), {
      method: 'POST',
      body: JSON.stringify({
        type: 'witness_art_cancel',
        commit_txid: composeResult.commit_txid,
      }),
    }).catch(() => undefined)
    throw error
  }

  const parsed = Psbt.fromHex(signedPsbt)
  try {
    parsed.finalizeAllInputs()
  } catch {
    // UniSat often returns an already finalized PSBT.
  }

  const rawHex = parsed.extractTransaction().toHex()
  const broadcastResult = await jsonFetch<{ txid?: string }>(resolveAcmeUrl('/admin/bitcoin/transactions'), {
    method: 'POST',
    body: JSON.stringify({ hex: rawHex }),
  })

  const txid = broadcastResult.txid?.trim()
  if (!txid) throw new Error('Broadcast failed: backend returned no txid.')
  return txid
}
