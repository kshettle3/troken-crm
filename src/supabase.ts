import { createClient } from '@supabase/supabase-js'
const SUPABASE_URL = 'https://lzlakfltczjtlrfvuinq.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6bGFrZmx0Y3pqdGxyZnZ1aW5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDExMTk3NTUsImV4cCI6MjA1NjY5NTc1NX0.lmpJREjuoNbjHMPrKJfBhiXUz7x5IX-Q8bqf7T7KH0s'
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
