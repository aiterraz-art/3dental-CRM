const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Manually parse .env
const envPath = path.resolve(__dirname, '.env');
let supabaseUrl, supabaseKey;

if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            process.env[key.trim()] = value.trim();
        }
    });
}

supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ksrlrqrqjqknobqdumzq.supabase.co';
supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
    console.error('Missing VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectData() {
    console.log('--- INSPECTING CLIENTS ---');
    const { data: clients, error: clientError } = await supabase
        .from('clients')
        .select('id, name, comuna, zone')
        .ilike('name', '%dental alfredo%');

    if (clientError) console.error('Client Error:', clientError);
    else console.log('Clients found:', clients);

    console.log('\n--- INSPECTING PROFILES (ADMIN) ---');
    const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, email, full_name, role')
        .or('role.eq.admin,email.ilike.%admin%');

    if (profileError) console.error('Profile Error:', profileError);
    else console.log('Profiles found:', profiles);
}

inspectData();
