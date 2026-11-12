// Đồng bộ giải thưởng từ ORCID vào public/profile.json.
// Chỉ THÊM mục mới: id = put-code của ORCID, image_path để trống cho bạn điền sau.
// Không xoá hay ghi đè các mục đã có.
import { readFile, writeFile } from 'node:fs/promises'

const file = new URL('../public/profile.json', import.meta.url)
const profile = JSON.parse(await readFile(file, 'utf8'))

let data
try {
  const res = await fetch(`https://pub.orcid.org/v3.0/${profile.orcid}/distinctions`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  data = await res.json()
} catch (err) {
  console.warn(`Không đọc được ORCID (${err.message}); giữ nguyên awards.`)
  process.exit(0)
}

const groups = data['affiliation-group'] || data.group || []
const ids = groups
  .map((g) => {
    const s = g.summaries?.[0]
    const item = s?.['distinction-summary'] || Object.values(s || {})[0]
    return item?.['put-code']
  })
  .filter((x) => x != null)
  .map(String)

const awards = Array.isArray(profile.awards) ? profile.awards : []
const known = new Set(awards.map((a) => String(a.id)))
const added = ids.filter((id) => !known.has(id))

if (!added.length) {
  console.log('Awards đã đầy đủ, không có mục mới.')
  process.exit(0)
}

profile.awards = [...awards, ...added.map((id) => ({ id, image_path: '' }))]
await writeFile(file, JSON.stringify(profile, null, 2) + '\n')
console.log(`Đã thêm ${added.length} mục mới: ${added.join(', ')}`)