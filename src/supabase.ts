import { createClient } from '@supabase/supabase-js'

// Hardcoded credentials — these are the anon (public) key, safe for client-side use
const SUPABASE_URL = 'https://lzlakfltczjtlrfvuinq.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6bGFrZmx0Y3pqdGxyZnZ1aW5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MTM5ODYsImV4cCI6MjA4ODI4OTk4Nn0.ityNWq4gxNRPN7EVDFxKyu5iQi0_OVSgg9w0-pJQRkY'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
