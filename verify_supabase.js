
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://ksrlrqrqjqknobqdumzq.supabase.co'
const supabaseKey = 'sb_publishable_Tqm5NhWzsQF_XLo7pwlTwg_v7jCO08i'

const supabase = createClient(supabaseUrl, supabaseKey)

async function testConnection() {
  console.log('Testing IDs for relationships...')
  try {
    const { data: qRows } = await supabase.from('quotations').select('seller_id, client_id')
    const { data: pRows } = await supabase.from('profiles').select('id')
    const { data: cRows } = await supabase.from('clients').select('id')

    console.log('--- QUOTATIONS (Seller IDs) ---')
    console.log(qRows.map(r => r.seller_id))

    console.log('--- PROFILES (IDs) ---')
    console.log(pRows.map(r => r.id))

    console.log('--- CLIENTS (IDs) ---')
    console.log(cRows.map(r => r.id))

    const missingSellers = qRows.filter(q => !pRows.some(p => p.id === q.seller_id))
    const missingClients = qRows.filter(q => !cRows.some(c => c.id === q.client_id))

    console.log('Missing Sellers count:', missingSellers.length)
    console.log('Missing Clients count:', missingClients.length)
  } catch (err) {
    console.error('Unexpected error:', err)
  }
}

testConnection()
