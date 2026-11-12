<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import Pager from './Pager.vue'

const PAGE_SIZE = 10
const MAX_AUTHORS = 10
const base = import.meta.env.BASE_URL

const profile = ref(null)
const works = ref([])
const worksState = ref('loading') // loading | ready | empty | error
const details = ref({}) // doi -> { authors, venue } lấy từ Crossref
const requested = new Set()
const avatarFailed = ref(false)
const failedImages = ref(new Set())
const pubPage = ref(1)
const awardPage = ref(1)
const distinctions = ref([]) // lấy từ ORCID
const educations = ref([]) // lấy từ ORCID
const affLoaded = ref(false)

const assetUrl = (path) => base + path

// Bỏ dấu, chữ thường: dùng để nhận ra tên mình trong danh sách tác giả
const norm = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()

const initials = computed(() =>
  (profile.value?.name || '')
    .split(' ')
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
)

/* ---------- Publications (ORCID + Crossref) ---------- */
const sortedWorks = computed(() =>
  [...works.value].sort((a, b) => {
    if (a.year === 'n.d.') return 1
    if (b.year === 'n.d.') return -1
    return Number(b.year) - Number(a.year)
  })
)
const pagedWorks = computed(() =>
  sortedWorks.value.slice((pubPage.value - 1) * PAGE_SIZE, pubPage.value * PAGE_SIZE)
)

function isMe(author) {
  const orcid = profile.value?.orcid
  if (author.ORCID && orcid && author.ORCID.includes(orcid)) return true
  const mine = norm(profile.value?.name).split(/\s+/).filter(Boolean)
  const theirs = norm(`${author.given || ''} ${author.family || ''}`).split(/\s+/).filter(Boolean)
  return theirs.length > 1 && theirs.every((t) => mine.includes(t))
}

function shortName(a) {
  if (!a.family) return a.name || ''
  const ini = (a.given || '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((g) => g[0].toUpperCase() + '.')
    .join(' ')
  return `${ini} ${a.family}`.trim()
}

async function loadDetails(list) {
  const todo = list.filter((w) => w.doi && !requested.has(w.doi))
  todo.forEach((w) => requested.add(w.doi))
  await Promise.allSettled(
    todo.map(async (w) => {
      const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(w.doi)}`)
      if (!res.ok) return
      const m = (await res.json()).message
      const title = m['container-title']?.[0] || ''
      const vi = m.volume ? `${m.volume}${m.issue ? ` (${m.issue})` : ''}` : ''
      details.value = {
        ...details.value,
        [w.doi]: {
          authors: (m.author || []).map((a) => ({ name: shortName(a), me: isMe(a) })),
          venue: title ? `${title}${vi ? ' ' + vi : ''}${m.page ? ', ' + m.page : ''}` : '',
        },
      }
    })
  )
}
watch(pagedWorks, loadDetails, { immediate: true })

function authorsOf(w) {
  const list = details.value[w.doi]?.authors || []
  if (list.length <= MAX_AUTHORS) return list
  return [...list.slice(0, MAX_AUTHORS), { name: `+${list.length - MAX_AUTHORS} more`, extra: true }]
}
const venueOf = (w) => details.value[w.doi]?.venue || w.journal

/* ---------- Biểu đồ số bài theo năm (từ ORCID) ---------- */
const chart = computed(() => {
  const counts = {}
  for (const w of works.value) if (w.year !== 'n.d.') counts[w.year] = (counts[w.year] || 0) + 1
  const years = Object.keys(counts).map(Number)
  if (!years.length) return null
  const max = Math.max(...years)
  const min = Math.max(Math.min(...years), max - 7)
  const top = Math.max(2, Math.ceil(Math.max(...Object.values(counts)) / 2) * 2)
  const bars = []
  for (let y = min; y <= max; y++) {
    const n = counts[y] || 0
    bars.push({ year: y, n, h: (n / top) * 100 })
  }
  return { bars, top }
})

/* ---------- Achievements + Education: nội dung từ ORCID, ảnh từ profile.json ---------- */
const startYear = (x) => Number(x.start || x.end || 0)

// profile.awards = [{ id: <put-code ORCID>, image_path }]
const imageById = computed(() =>
  Object.fromEntries((profile.value?.awards || []).map((a) => [String(a.id), a.image_path]))
)
const awards = computed(() =>
  [...distinctions.value]
    .sort((a, b) => startYear(b) - startYear(a))
    .map((d) => ({
      id: d.id,
      title: d.title || d.dept || 'Distinction',
      note: d.title ? d.dept : '',
      org: d.org,
      year: d.start,
      image: imageById.value[d.id] || '',
    }))
)
const sortedEducations = computed(() =>
  [...educations.value].sort((a, b) => startYear(b) - startYear(a))
)
function period(e) {
  if (!e.start && !e.end) return ''
  if (!e.end) return `${e.start} – present`
  return e.start && e.start !== e.end ? `${e.start} – ${e.end}` : e.end
}
const pagedAwards = computed(() =>
  awards.value.slice((awardPage.value - 1) * PAGE_SIZE, awardPage.value * PAGE_SIZE)
)
const markImageFailed = (path) => {
  failedImages.value = new Set(failedImages.value).add(path)
}

function setPubPage(p) {
  pubPage.value = p
  document.getElementById('publications')?.scrollIntoView()
}
function setAwardPage(p) {
  awardPage.value = p
  document.getElementById('achievements')?.scrollIntoView()
}

async function loadWorks(orcid) {
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcid}/works`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(res.status)
    const data = await res.json()
    works.value = (data.group || []).map((g) => {
      const s = g['work-summary'][0]
      const ids = s['external-ids']?.['external-id'] || []
      const doi = ids.find((e) => e['external-id-type'] === 'doi')?.['external-id-value']
      return {
        id: s['put-code'],
        title: s.title?.title?.value || 'Untitled',
        journal: s['journal-title']?.value || '',
        year: s['publication-date']?.year?.value || 'n.d.',
        doi: doi ? doi.trim().toLowerCase() : '',
        link: doi ? `https://doi.org/${doi.trim()}` : s.url?.value || '',
      }
    })
    worksState.value = works.value.length ? 'ready' : 'empty'
  } catch {
    worksState.value = 'error'
  }
}

// Distinctions (giải thưởng) và Educations (học vấn) có cùng cấu trúc trả về
function parseAffiliations(data, kind) {
  const groups = data['affiliation-group'] || data.group || []
  return groups
    .map((g) => {
      const s = g.summaries?.[0]
      const item = s?.[`${kind}-summary`] || Object.values(s || {})[0]
      if (!item) return null
      return {
        id: String(item['put-code']),
        title: item['role-title'] || '',
        dept: item['department-name'] || '',
        org: item.organization?.name || '',
        start: item['start-date']?.year?.value || '',
        end: item['end-date']?.year?.value || '',
      }
    })
    .filter(Boolean)
}

async function loadAffiliations(orcid) {
  const get = async (kind, path) => {
    try {
      const res = await fetch(`https://pub.orcid.org/v3.0/${orcid}/${path}`, {
        headers: { Accept: 'application/json' },
      })
      return res.ok ? parseAffiliations(await res.json(), kind) : []
    } catch {
      return []
    }
  }
  const [d, e] = await Promise.all([get('distinction', 'distinctions'), get('education', 'educations')])
  distinctions.value = d
  educations.value = e
  affLoaded.value = true
}

onMounted(async () => {
  const res = await fetch(assetUrl('profile.json'))
  profile.value = await res.json()
  document.title = `${profile.value.name} | Academic Portfolio`
  loadWorks(profile.value.orcid)
  loadAffiliations(profile.value.orcid)
})
</script>

<template>
  <div v-if="profile">
    <header class="site-header">
      <div class="wrap topbar">
        <a class="brand" href="#top">{{ profile.name }}</a>
        <nav aria-label="Main">
          <a href="#about">About</a>
          <a href="#publications">Publications</a>
          <a href="#achievements">Achievements</a>
          <a href="#contact">Contact</a>
        </nav>
      </div>
    </header>

    <main id="top" class="wrap">
      <!-- Giới thiệu: dải ngang gọn -->
      <section id="about" class="profile">
        <div class="portrait">
          <img
            v-if="!avatarFailed"
            :src="assetUrl('images/avatar.jpg')"
            :alt="`Portrait of ${profile.name}`"
            @error="avatarFailed = true"
          />
          <span v-else aria-hidden="true">{{ initials }}</span>
        </div>
        <div class="who">
          <h1>{{ profile.name }}</h1>
          <p class="role">{{ profile.title }}</p>
          <p class="affil">{{ profile.affiliation }}</p>
        </div>
        <div class="meta">
          <p class="mail"><a :href="`mailto:${profile.email}`">{{ profile.email }}</a></p>
          <div v-if="profile.interests?.length" class="tags">
            <span v-for="t in profile.interests" :key="t">{{ t }}</span>
          </div>
          <div class="ids">
            <a :href="`https://orcid.org/${profile.orcid}`" target="_blank" rel="noopener">ORCID</a>
            <a v-for="l in profile.links" :key="l.url" :href="l.url" target="_blank" rel="noopener">{{ l.label }}</a>
          </div>
        </div>
      </section>

      <div class="cols">
        <div>
          <!-- Bài báo lấy từ ORCID, tác giả lấy từ Crossref -->
          <section id="publications">
            <h2>Publications</h2>

            <p v-if="worksState === 'loading'" class="state">Loading publications…</p>
            <p v-else-if="worksState === 'error'" class="state">
              Could not load publications. Open the
              <a :href="`https://orcid.org/${profile.orcid}`" target="_blank" rel="noopener">ORCID record</a>
              to see the full list.
            </p>
            <p v-else-if="worksState === 'empty'" class="state">
              No public works found. Add works on ORCID and set their visibility to Everyone.
            </p>

            <template v-if="worksState === 'ready'">
              <div class="thead"><span>Title</span><span>Year</span></div>
              <div v-for="w in pagedWorks" :key="w.id" class="pub">
                <div>
                  <a v-if="w.link" :href="w.link" target="_blank" rel="noopener">{{ w.title }}</a>
                  <span v-else class="ptitle">{{ w.title }}</span>
                  <p v-if="authorsOf(w).length" class="authors">
                    <template v-for="(a, i) in authorsOf(w)" :key="i">
                      <b v-if="a.me">{{ a.name }}</b><template v-else>{{ a.name }}</template><template v-if="i < authorsOf(w).length - 1">, </template>
                    </template>
                  </p>
                  <p v-if="venueOf(w)" class="venue">{{ venueOf(w) }}</p>
                </div>
                <div class="yr">{{ w.year }}</div>
              </div>
              <Pager :page="pubPage" :total="works.length" :size="PAGE_SIZE" @update:page="setPubPage" />
              <p class="sync">
                Synced from my
                <a :href="`https://orcid.org/${profile.orcid}`" target="_blank" rel="noopener">ORCID record</a>.
              </p>
            </template>
          </section>

          <!-- Thành tích / giải thưởng (có hình) -->
          <section id="achievements">
            <h2>Achievements</h2>
            <p v-if="!affLoaded" class="state">Loading achievements…</p>
            <p v-else-if="!awards.length" class="state">No public distinctions found on ORCID.</p>
            <div v-for="a in pagedAwards" :key="a.id" class="award">
              <div class="thumb">
                <img
                  v-if="a.image && !failedImages.has(a.image)"
                  :src="assetUrl(a.image)"
                  :alt="a.title"
                  loading="lazy"
                  @error="markImageFailed(a.image)"
                />
                <span v-else aria-hidden="true">{{ a.year || '•' }}</span>
              </div>
              <div>
                <h3>{{ a.title }}</h3>
                <p>{{ [a.org, a.year].filter(Boolean).join(', ') }}</p>
                <p v-if="a.note">{{ a.note }}</p>
              </div>
            </div>
            <Pager :page="awardPage" :total="awards.length" :size="PAGE_SIZE" @update:page="setAwardPage" />
          </section>
        </div>

        <aside>
          <div v-if="chart" class="blk">
            <h2>Publications per year</h2>
            <div class="chart" role="img" aria-label="Bar chart of publications per year">
              <div class="plot">
                <div v-for="b in chart.bars" :key="b.year" class="col">
                  <div class="bw"><div class="bar" :style="{ height: b.h + '%' }" :title="`${b.year}: ${b.n}`"></div></div>
                  <span>{{ b.year }}</span>
                </div>
              </div>
              <div class="ylab"><span>{{ chart.top }}</span><span>{{ chart.top / 2 }}</span><span>0</span></div>
            </div>
          </div>
          <div v-if="sortedEducations.length" class="blk">
            <h2>Education</h2>
            <ul class="edu">
              <li v-for="e in sortedEducations" :key="e.id">
                <b>{{ e.title || e.dept }}</b>
                <span v-if="e.title && e.dept">{{ e.dept }}</span>
                <span>{{ e.org }}</span>
                <span v-if="period(e)">{{ period(e) }}</span>
              </li>
            </ul>
          </div>
          <div class="blk">
            <h2>Profiles</h2>
            <ul>
              <li><a :href="`https://orcid.org/${profile.orcid}`" target="_blank" rel="noopener">ORCID: {{ profile.orcid }}</a></li>
              <li v-for="l in profile.links" :key="l.url"><a :href="l.url" target="_blank" rel="noopener">{{ l.label }}</a></li>
            </ul>
          </div>
        </aside>
      </div>
    </main>

    <footer id="contact" class="site-footer">
      <div class="wrap foot">
        <div>
          <p class="fn">{{ profile.name }}</p>
          <p class="fa">{{ profile.affiliation }}</p>
        </div>
        <div class="fl">
          <a :href="`mailto:${profile.email}`">{{ profile.email }}</a>
          <a :href="`https://orcid.org/${profile.orcid}`" target="_blank" rel="noopener">orcid.org/{{ profile.orcid }}</a>
        </div>
      </div>
      <p class="copy">© {{ new Date().getFullYear() }} {{ profile.name }}</p>
    </footer>
  </div>
</template>

<style>
:root {
  --main: #0a4d2e; /* xanh lá đậm: đổi một giá trị này để đổi màu header/footer */
  --ink: #17231c;
  --muted: #5a6b60;
  --paper: #fff;
  --alt: #eef3ef;
  --line: #d9e2db;
  --accent: var(--main); /* màu chữ/link/viền trong phần nội dung */
  box-sizing: border-box;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e4f0e8; --muted: #a8bfb0; --paper: #0c1a13; --alt: #13281d;
    --line: #244334; --accent: #5fd19a; color-scheme: dark;
  }
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 72px; }
body { margin: 0; font: 1rem/1.6 'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--ink); background: var(--paper); }
h1, h2, h3 { font-family: 'Newsreader', Georgia, 'Times New Roman', serif; line-height: 1.25; margin: 0; }
a { color: var(--accent); }
a:focus-visible, button:focus-visible { outline: 3px solid #7fd1ff; outline-offset: 2px; }
.wrap { max-width: 1040px; margin: 0 auto; padding: 0 24px; }

/* Header */
.site-header { position: sticky; top: 0; z-index: 10; background: var(--main); color: #fff; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 56px; flex-wrap: wrap; }
.brand { font: 600 1.25rem 'Newsreader', Georgia, serif; color: #fff; text-decoration: none; }
.site-header nav { display: flex; gap: 22px; }
.site-header nav a { color: #dcefe3; text-decoration: none; font-size: 0.95rem; font-weight: 500; padding: 4px 0; border-bottom: 2px solid transparent; }
.site-header nav a:hover { color: #fff; border-bottom-color: #fff; }

/* Giới thiệu */
.profile { display: grid; grid-template-columns: 88px minmax(0, 1.2fr) minmax(0, 1fr); gap: 24px; align-items: center; padding: 20px 0; border-bottom: 1px solid var(--line); }
.portrait { width: 88px; height: 88px; border-radius: 50%; background: var(--main); color: #fff; display: grid; place-items: center; font: 600 1.9rem 'Newsreader', Georgia, serif; overflow: hidden; }
.portrait img { width: 100%; height: 100%; object-fit: cover; display: block; }
.profile h1 { font-size: 1.6rem; font-weight: 600; }
.role { margin: 2px 0 0; font-size: 1rem; }
.affil { margin: 0; color: var(--muted); }
.meta { border-left: 1px solid var(--line); padding-left: 24px; font-size: 0.92rem; }
.mail { margin: 0; }
.tags { display: flex; flex-wrap: wrap; gap: 2px 14px; margin: 6px 0 0; color: var(--accent); }
.ids { margin: 6px 0 0; display: flex; flex-wrap: wrap; gap: 2px 16px; }

/* Bố cục 2 cột */
.cols { display: grid; grid-template-columns: 1fr 280px; gap: 48px; padding: 24px 0 56px; align-items: start; }
section { margin-bottom: 48px; }
section:last-child { margin-bottom: 0; }
h2 { font-size: 1.5rem; font-weight: 600; padding-bottom: 8px; border-bottom: 2px solid var(--accent); }
.state { color: var(--muted); }
.sync { margin: 12px 0 0; color: var(--muted); font-size: 0.9rem; }

/* Publications */
.thead { display: grid; grid-template-columns: 1fr 56px; background: var(--alt); padding: 8px 12px; font-size: 0.9rem; font-weight: 600; color: var(--muted); margin-top: 16px; }
.thead span:last-child, .yr { text-align: right; }
.pub { display: grid; grid-template-columns: 1fr 56px; gap: 12px; padding: 12px; border-bottom: 1px solid var(--line); }
.pub a, .ptitle { font-weight: 500; }
.pub a { text-decoration: none; }
.pub a:hover { text-decoration: underline; }
.authors, .venue { margin: 2px 0 0; font-size: 0.9rem; color: var(--muted); }
.authors b { color: var(--ink); font-weight: 600; }
.yr { font-size: 0.95rem; }

/* Achievements */
.award { display: grid; grid-template-columns: 128px 1fr; gap: 18px; padding: 16px 12px; border-bottom: 1px solid var(--line); }
.thumb { width: 128px; aspect-ratio: 4 / 3; background: var(--main); color: rgba(255, 255, 255, 0.9); display: grid; place-items: center; font: 600 1.5rem 'Newsreader', Georgia, serif; border-radius: 4px; overflow: hidden; }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.award h3 { font-size: 1.1rem; font-weight: 600; }
.award p { margin: 2px 0 0; font-size: 0.95rem; color: var(--muted); }

/* Sidebar */
aside h2 { font-size: 1.15rem; }
aside .blk { margin-bottom: 32px; }
aside ul { list-style: none; margin: 8px 0 0; padding: 0; }
aside li { padding: 5px 0; font-size: 0.95rem; }
.edu li { display: block; padding: 10px 0; border-bottom: 1px solid var(--line); }
.edu b { display: block; font-weight: 600; }
.edu span { display: block; font-size: 0.9rem; color: var(--muted); }
.chart { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 14px; height: 190px; }
.plot { display: flex; gap: 6px; }
.col { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.bw { flex: 1; display: flex; align-items: flex-end; border-bottom: 1px solid var(--line); }
.bar { width: 100%; background: var(--accent); opacity: 0.8; }
.col span { font-size: 0.72rem; color: var(--muted); text-align: center; margin-top: 4px; height: 18px; }
.ylab { display: flex; flex-direction: column; justify-content: space-between; font-size: 0.75rem; color: var(--muted); padding-bottom: 22px; }

/* Footer */
.site-footer { background: var(--main); color: #fff; padding: 36px 0 18px; }
.foot { display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.fn { margin: 0; font: 600 1.3rem 'Newsreader', Georgia, serif; }
.fa { margin: 2px 0 0; color: #c6e2d1; }
.fl { display: flex; flex-direction: column; gap: 4px; }
.fl a { color: #fff; }
.copy { max-width: 1040px; margin: 24px auto 0; padding: 14px 24px 0; border-top: 1px solid rgba(255, 255, 255, 0.3); color: #c6e2d1; font-size: 0.9rem; }

@media (max-width: 820px) {
  .cols { grid-template-columns: 1fr; gap: 40px; }
  .profile { grid-template-columns: 72px 1fr; gap: 16px; }
  .portrait { width: 72px; height: 72px; font-size: 1.5rem; }
  .meta { grid-column: 1 / -1; border-left: 0; padding-left: 0; }
  .topbar { justify-content: center; padding: 8px 24px; }
  .site-header nav { gap: 16px; }
  .award { grid-template-columns: 96px 1fr; }
  .thumb { width: 96px; }
}
</style>
